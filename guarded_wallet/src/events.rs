use odra::prelude::*;
use odra::casper_types::U512;
#[odra::event] pub struct Deposited { pub from: Address, pub amount: U512 }
#[odra::event] pub struct Paid { pub payee: Address, pub amount: U512, pub spent_in_period: U512 }
#[odra::event] pub struct PolicyChanged { pub per_tx_max: U512, pub period_cap: U512, pub period_len: u64 }
#[odra::event] pub struct DeviceKeyRotated { pub new_device: Address }
