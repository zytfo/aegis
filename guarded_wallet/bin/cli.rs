//! Minimal CLI for the guarded_wallet contract (GuardedWallet).

use guarded_wallet::{GuardedWallet, GuardedWalletInitArgs};
use odra::host::HostEnv;
use odra::casper_types::U512;
use odra_cli::{
    deploy::DeployScript,
    DeployedContractsContainer, DeployerExt,
    OdraCli,
};

/// Deploys the `GuardedWallet` and adds it to the container.
pub struct GuardedWalletDeployScript;

impl DeployScript for GuardedWalletDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer
    ) -> Result<(), odra_cli::deploy::Error> {
        let owner = env.get_account(0);
        let device = env.get_account(1);
        let args = GuardedWalletInitArgs {
            owner,
            device,
            per_tx_max: U512::from(5_000_000_000u64),   // 5 CSPR
            period_cap: U512::from(20_000_000_000u64),  // 20 CSPR
            period_len: 3_600_000u64,                   // 1 hour in ms
        };
        let _wallet = GuardedWallet::load_or_deploy(
            &env,
            args,
            container,
            350_000_000_000 // Adjust gas limit as needed
        )?;

        Ok(())
    }
}

/// Main function to run the CLI tool.
pub fn main() {
    OdraCli::new()
        .about("CLI tool for guarded_wallet smart contract")
        .deploy(GuardedWalletDeployScript)
        .contract::<GuardedWallet>()
        .build()
        .run();
}
