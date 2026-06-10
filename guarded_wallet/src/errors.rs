use odra::prelude::*;
#[odra::odra_error]
#[derive(PartialEq, Eq, Debug)]
pub enum Error { OverPerTx = 1, OverCap = 2, PayeeNotAllowed = 3, NotOwner = 4, NotDevice = 5, NotInitialized = 6, AlreadyInitialized = 7, InvalidPolicy = 8, InsufficientFunds = 9 }
