use odra::casper_types::U512;
use crate::errors::Error;
pub fn check_per_tx(per_tx_max: U512, amount: U512) -> Result<(), Error> {
    if amount > per_tx_max { return Err(Error::OverPerTx); } Ok(())
}
pub fn check_cap(period_cap: U512, spent: U512, amount: U512) -> Result<(), Error> {
    match spent.checked_add(amount) {
        None => Err(Error::OverCap),
        Some(total) => if total > period_cap { Err(Error::OverCap) } else { Ok(()) },
    }
}
/// Pure helper computing the current-period spent value and period_start
/// WITHOUT mutating any state. If the period has elapsed (`now >= start + len`,
/// computed with overflow safety), the period is considered rolled: returns
/// `(0, now)`. Otherwise returns the stored `(stored_spent, start)`.
/// On `start + len` overflow we treat the period as NOT rolled (keep current).
pub fn current_spent(now: u64, start: u64, len: u64, stored_spent: U512) -> (U512, u64) {
    match start.checked_add(len) {
        Some(end) if now >= end => (U512::zero(), now),
        _ => (stored_spent, start),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn per_tx_rejects() { assert_eq!(check_per_tx(U512::from(100u64), U512::from(101u64)), Err(Error::OverPerTx)); }
    #[test] fn per_tx_allows() { assert_eq!(check_per_tx(U512::from(100u64), U512::from(100u64)), Ok(())); }
    #[test] fn cap_rejects() { assert_eq!(check_cap(U512::from(250u64), U512::from(200u64), U512::from(100u64)), Err(Error::OverCap)); }
    #[test] fn cap_allows() { assert_eq!(check_cap(U512::from(250u64), U512::from(100u64), U512::from(100u64)), Ok(())); }
    #[test] fn cap_overflow_returns_over_cap_not_panic() {
        // spent near U512::MAX + amount would wrap; must return Err(OverCap), not panic/wrap.
        assert_eq!(check_cap(U512::MAX, U512::MAX, U512::from(1u64)), Err(Error::OverCap));
        assert_eq!(check_cap(U512::MAX, U512::from(2u64), U512::MAX - U512::from(1u64)), Err(Error::OverCap));
    }
    #[test] fn current_spent_elapsed_resets() {
        // now >= start + len -> rolled: spent 0, period_start = now
        let (spent, start) = current_spent(200, 100, 50, U512::from(42u64));
        assert_eq!(spent, U512::zero());
        assert_eq!(start, 200);
    }
    #[test] fn current_spent_not_elapsed_keeps() {
        let (spent, start) = current_spent(120, 100, 50, U512::from(42u64));
        assert_eq!(spent, U512::from(42u64));
        assert_eq!(start, 100);
    }
    #[test] fn current_spent_overflow_keeps_current() {
        // start + len overflows u64 -> treat as NOT rolled (keep stored)
        let (spent, start) = current_spent(u64::MAX, u64::MAX, 10, U512::from(7u64));
        assert_eq!(spent, U512::from(7u64));
        assert_eq!(start, u64::MAX);
    }
}
