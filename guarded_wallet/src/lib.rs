#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

pub mod errors;
pub mod policy;
pub mod events;

use odra::prelude::*;
use odra::casper_types::U512;
use crate::errors::Error;
use crate::events::{Deposited, Paid, PolicyChanged, DeviceKeyRotated};
use crate::policy::{check_per_tx, check_cap, current_spent};

#[odra::odra_type]
pub struct WalletState { pub owner: Address, pub device: Address, pub balance: U512, pub per_tx_max: U512, pub period_cap: U512, pub spent_in_period: U512, pub period_start: u64, pub period_len: u64 }

#[odra::module(errors = Error, events = [Deposited, Paid, PolicyChanged, DeviceKeyRotated])]
pub struct GuardedWallet {
    owner: Var<Address>, device: Var<Address>, allowlist: Mapping<Address, bool>,
    per_tx_max: Var<U512>, period_cap: Var<U512>, period_len: Var<u64>,
    spent_in_period: Var<U512>, period_start: Var<u64>,
    payees: Var<Vec<Address>>,
}

#[odra::module]
impl GuardedWallet {
    pub fn init(&mut self, owner: Address, device: Address, per_tx_max: U512, period_cap: U512, period_len: u64) {
        // Defensive re-initialization guard. Odra constructors are not exposed as
        // callable entrypoints post-deploy, but guard anyway against any code path
        // that could call init twice.
        if self.owner.get().is_some() { self.env().revert(Error::AlreadyInitialized); }
        if period_len == 0 { self.env().revert(Error::InvalidPolicy); }
        self.owner.set(owner); self.device.set(device);
        self.per_tx_max.set(per_tx_max); self.period_cap.set(period_cap); self.period_len.set(period_len);
        self.spent_in_period.set(U512::zero()); self.period_start.set(self.env().get_block_time());
        self.payees.set(Vec::new());
    }
    #[odra(payable)]
    pub fn deposit(&mut self) {
        let from = self.env().caller(); let amount = self.env().attached_value();
        self.env().emit_event(Deposited { from, amount });
    }
    pub fn balance(&self) -> U512 { self.env().self_balance() }
    pub fn is_allowed(&self, payee: Address) -> bool { self.allowlist.get(&payee).unwrap_or(false) }
    pub fn get_state(&self) -> WalletState {
        // Read-only current-period view: do NOT mutate state here.
        let now = self.env().get_block_time();
        let (spent, start) = current_spent(now, self.period_start.get_or_default(),
            self.period_len.get_or_default(), self.spent_in_period.get_or_default());
        WalletState {
            owner: self.owner.get_or_revert_with(Error::NotInitialized),
            device: self.device.get_or_revert_with(Error::NotInitialized),
            balance: self.env().self_balance(), per_tx_max: self.per_tx_max.get_or_default(),
            period_cap: self.period_cap.get_or_default(), spent_in_period: spent,
            period_start: start, period_len: self.period_len.get_or_default() }
    }
    fn assert_owner(&self) { if self.env().caller() != self.owner.get_or_revert_with(Error::NotInitialized) { self.env().revert(Error::NotOwner); } }
    fn assert_device(&self) { if self.env().caller() != self.device.get_or_revert_with(Error::NotInitialized) { self.env().revert(Error::NotDevice); } }
    pub fn set_policy(&mut self, per_tx_max: U512, period_cap: U512, period_len: u64) {
        self.assert_owner();
        if period_len == 0 { self.env().revert(Error::InvalidPolicy); }
        self.per_tx_max.set(per_tx_max); self.period_cap.set(period_cap); self.period_len.set(period_len);
        self.env().emit_event(PolicyChanged { per_tx_max, period_cap, period_len });
    }
    pub fn list_payees(&self) -> Vec<Address> { self.payees.get_or_default() }
    pub fn add_payee(&mut self, payee: Address) {
        self.assert_owner(); self.allowlist.set(&payee, true);
        let mut list = self.payees.get_or_default();
        if !list.contains(&payee) { list.push(payee); self.payees.set(list); }
    }
    pub fn remove_payee(&mut self, payee: Address) {
        self.assert_owner(); self.allowlist.set(&payee, false);
        let mut list = self.payees.get_or_default();
        if let Some(i) = list.iter().position(|p| *p == payee) { list.remove(i); self.payees.set(list); }
    }
    pub fn rotate_device_key(&mut self, new_device: Address) { self.assert_owner(); self.device.set(new_device); self.env().emit_event(DeviceKeyRotated { new_device }); }
    fn roll_period_if_needed(&mut self) {
        let now = self.env().get_block_time();
        let (spent, start) = current_spent(now, self.period_start.get_or_default(),
            self.period_len.get_or_default(), self.spent_in_period.get_or_default());
        self.period_start.set(start); self.spent_in_period.set(spent);
    }
    pub fn pay(&mut self, payee: Address, amount: U512) {
        self.assert_device();
        if !self.is_allowed(payee) { self.env().revert(Error::PayeeNotAllowed); }
        if let Err(e) = check_per_tx(self.per_tx_max.get_or_default(), amount) { self.env().revert(e); }
        self.roll_period_if_needed();
        let spent = self.spent_in_period.get_or_default();
        if let Err(e) = check_cap(self.period_cap.get_or_default(), spent, amount) { self.env().revert(e); }
        if self.env().self_balance() < amount { self.env().revert(Error::InsufficientFunds); }
        // CEI ordering (defensive): update accounting before the external transfer.
        let new_spent = spent + amount; self.spent_in_period.set(new_spent);
        self.env().transfer_tokens(&payee, &amount);
        self.env().emit_event(Paid { payee, amount, spent_in_period: new_spent });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostEnv, HostRef};

    fn setup() -> (HostEnv, GuardedWalletHostRef) {
        let env: HostEnv = odra_test::env();
        let owner = env.get_account(0);
        let device = env.get_account(1);
        let args = GuardedWalletInitArgs {
            owner, device,
            per_tx_max: U512::from(100u64),
            period_cap: U512::from(250u64),
            period_len: 100_000u64,
        };
        let contract = GuardedWallet::deploy(&env, args);
        (env, contract)
    }

    fn funded() -> (HostEnv, GuardedWalletHostRef) {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let payee = env.get_account(2);
        env.set_caller(owner);
        contract.add_payee(payee);
        contract.with_tokens(U512::from(1000u64)).deposit();
        (env, contract)
    }

    #[test]
    fn deposit_increases_balance_and_emits() {
        let (env, contract) = setup();
        let owner = env.get_account(0);
        env.set_caller(owner);
        contract.with_tokens(U512::from(500u64)).deposit();
        assert_eq!(contract.balance(), U512::from(500u64));
        assert!(env.emitted_event(&contract, Deposited { from: owner, amount: U512::from(500u64) }));
    }

    #[test]
    fn owner_adds_payee_and_rotates_device() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let payee = env.get_account(2);
        let new_device = env.get_account(4);
        env.set_caller(owner);
        contract.add_payee(payee);
        assert!(contract.is_allowed(payee));
        contract.rotate_device_key(new_device);
    }

    #[test]
    fn non_owner_cannot_set_policy_or_rotate() {
        let (env, mut contract) = setup();
        let device = env.get_account(1);
        let some = env.get_account(4);
        env.set_caller(device);
        assert_eq!(
            contract.try_set_policy(U512::from(1u64), U512::from(1u64), 1u64),
            Err(Error::NotOwner.into())
        );
        assert_eq!(
            contract.try_rotate_device_key(some),
            Err(Error::NotOwner.into())
        );
    }

    #[test]
    fn device_pays_within_limits() {
        let (env, mut contract) = funded();
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(device);
        contract.pay(payee, U512::from(50u64));
        assert!(env.emitted_event(&contract, Paid { payee, amount: U512::from(50u64), spent_in_period: U512::from(50u64) }));
    }

    #[test]
    fn non_device_cannot_pay() {
        let (env, mut contract) = funded();
        let owner = env.get_account(0);
        let payee = env.get_account(2);
        env.set_caller(owner);
        assert_eq!(
            contract.try_pay(payee, U512::from(10u64)),
            Err(Error::NotDevice.into())
        );
    }

    #[test]
    fn rejects_non_allowlisted() {
        let (env, mut contract) = funded();
        let device = env.get_account(1);
        let stranger = env.get_account(3);
        env.set_caller(device);
        assert_eq!(
            contract.try_pay(stranger, U512::from(10u64)),
            Err(Error::PayeeNotAllowed.into())
        );
    }

    #[test]
    fn rejects_over_per_tx() {
        let (env, mut contract) = funded();
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(device);
        assert_eq!(
            contract.try_pay(payee, U512::from(101u64)),
            Err(Error::OverPerTx.into())
        );
    }

    #[test]
    fn rejects_over_cap() {
        let (env, mut contract) = funded();
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(device);
        contract.pay(payee, U512::from(100u64));
        contract.pay(payee, U512::from(100u64));
        assert_eq!(
            contract.try_pay(payee, U512::from(100u64)),
            Err(Error::OverCap.into())
        );
    }

    #[test]
    fn set_policy_zero_period_len_reverts() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        env.set_caller(owner);
        assert_eq!(
            contract.try_set_policy(U512::from(1u64), U512::from(1u64), 0u64),
            Err(Error::InvalidPolicy.into())
        );
    }

    #[test]
    fn get_state_reflects_spent_and_exposes_identity() {
        let (env, mut contract) = funded();
        let owner = env.get_account(0);
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(device);
        contract.pay(payee, U512::from(50u64));
        let st = contract.get_state();
        assert_eq!(st.spent_in_period, U512::from(50u64));
        assert_eq!(st.owner, owner);
        assert_eq!(st.device, device);
        assert_eq!(st.period_len, 100_000u64);
    }

    #[test]
    fn add_then_remove_reflected_in_list_payees() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let payee = env.get_account(2);
        env.set_caller(owner);
        contract.add_payee(payee);
        assert_eq!(contract.list_payees(), alloc::vec![payee]);
        // idempotent add
        contract.add_payee(payee);
        assert_eq!(contract.list_payees(), alloc::vec![payee]);
        contract.remove_payee(payee);
        assert!(contract.list_payees().is_empty());
    }

    #[test]
    fn owner_remove_payee_disallows_and_drops_from_list() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let payee = env.get_account(2);
        env.set_caller(owner);
        contract.add_payee(payee);
        assert!(contract.is_allowed(payee));
        contract.remove_payee(payee);
        assert!(!contract.is_allowed(payee));
        assert!(!contract.list_payees().contains(&payee));
    }

    #[test]
    fn non_owner_cannot_remove_payee() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(owner);
        contract.add_payee(payee);
        env.set_caller(device);
        assert_eq!(
            contract.try_remove_payee(payee),
            Err(Error::NotOwner.into())
        );
    }

    #[test]
    fn pay_insufficient_funds_reverts() {
        let (env, mut contract) = setup();
        let owner = env.get_account(0);
        let device = env.get_account(1);
        let payee = env.get_account(2);
        env.set_caller(owner);
        contract.add_payee(payee);
        contract.with_tokens(U512::from(10u64)).deposit();
        env.set_caller(device);
        // 50 is within policy (per_tx_max 100, cap 250) but exceeds the 10 deposited.
        assert_eq!(
            contract.try_pay(payee, U512::from(50u64)),
            Err(Error::InsufficientFunds.into())
        );
    }
}
