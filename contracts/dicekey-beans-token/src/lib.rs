#![no_std]

use dicekey_shared as shared;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[contracttype]
#[derive(Clone)]
enum BeansKey {
    Balance(Address),
    Allowance(Address, Address), // (from, spender)
    TotalSupply,
    Initialized,
}

#[contract]
pub struct DicekeyBeansToken;

#[contractimpl]
impl DicekeyBeansToken {
    /// Initialize the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().instance().has(&BeansKey::Initialized),
            "already initialized"
        );
        shared::set_admin(&env, &admin);
        env.storage().instance().set(&BeansKey::TotalSupply, &0i128);
        env.storage()
            .instance()
            .set(&BeansKey::Initialized, &true);
    }

    /// Read-only: whether `initialize()` has been called on this contract.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&BeansKey::Initialized)
    }

    // ── SEP-41 Token Interface ─────────────────────────

    pub fn name(env: Env) -> String {
        String::from_str(&env, "dicekey Beans")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "BEANS")
    }

    pub fn decimals(_env: Env) -> u32 {
        0
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&BeansKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&BeansKey::TotalSupply)
            .unwrap_or(0)
    }

    // ── Transfer ───────────────────────────────────────

    /// Transfer beans between accounts. Requires sender auth.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        Self::spend_balance(&env, &from, amount);
        Self::receive_balance(&env, &to, amount);

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("xfer")),
            (from, to, amount),
        );
    }

    // ── Allowance (SEP-41) ─────────────────────────────

    /// Approve `spender` to spend up to `amount` from `from`.
    pub fn approve(env: Env, from: Address, spender: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0, "amount must be non-negative");

        env.storage()
            .persistent()
            .set(&BeansKey::Allowance(from.clone(), spender.clone()), &amount);

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("approve")),
            (from, spender, amount),
        );
    }

    /// Get the current allowance for `spender` on `from`.
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&BeansKey::Allowance(from, spender))
            .unwrap_or(0)
    }

    /// Transfer using an allowance. Requires spender auth.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        spender.require_auth();
        assert!(amount > 0, "amount must be positive");

        let current = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(current >= amount, "insufficient allowance");

        env.storage().persistent().set(
            &BeansKey::Allowance(from.clone(), spender),
            &(current - amount),
        );

        Self::spend_balance(&env, &from, amount);
        Self::receive_balance(&env, &to, amount);

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("xfer")),
            (from, to, amount),
        );
    }

    // ── Mint / Burn (admin) ────────────────────────────

    /// Mint beans to a customer. Only callable by admin.
    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) {
        shared::require_admin(&env, &admin);
        assert!(amount > 0, "amount must be positive");

        Self::receive_balance(&env, &to, amount);

        let supply = Self::total_supply(env.clone());
        env.storage()
            .instance()
            .set(&BeansKey::TotalSupply, &(supply + amount));

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("mint")),
            (to, amount),
        );
    }

    /// Burn beans from a customer. Requires customer auth.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        Self::spend_balance(&env, &from, amount);

        let supply = Self::total_supply(env.clone());
        env.storage()
            .instance()
            .set(&BeansKey::TotalSupply, &(supply - amount));

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("burn")),
            (from, amount),
        );
    }

    /// Burn beans using an allowance (e.g., store burns on behalf of customer).
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        assert!(amount > 0, "amount must be positive");

        let current = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(current >= amount, "insufficient allowance");

        env.storage().persistent().set(
            &BeansKey::Allowance(from.clone(), spender),
            &(current - amount),
        );

        Self::spend_balance(&env, &from, amount);

        let supply = Self::total_supply(env.clone());
        env.storage()
            .instance()
            .set(&BeansKey::TotalSupply, &(supply - amount));

        env.events().publish(
            (symbol_short!("beans"), symbol_short!("burn")),
            (from, amount),
        );
    }

    // ── Internal ───────────────────────────────────────

    fn spend_balance(env: &Env, from: &Address, amount: i128) {
        let bal: i128 = env
            .storage()
            .persistent()
            .get(&BeansKey::Balance(from.clone()))
            .unwrap_or(0);
        assert!(bal >= amount, "insufficient balance");
        env.storage()
            .persistent()
            .set(&BeansKey::Balance(from.clone()), &(bal - amount));
    }

    fn receive_balance(env: &Env, to: &Address, amount: i128) {
        let bal: i128 = env
            .storage()
            .persistent()
            .get(&BeansKey::Balance(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BeansKey::Balance(to.clone()), &(bal + amount));
    }
}

// ── Tests ──────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, DicekeyBeansTokenClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(DicekeyBeansToken, ());
        let client = DicekeyBeansTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn test_name_symbol_decimals() {
        let (env, client, _) = setup();
        assert_eq!(client.name(), String::from_str(&env, "dicekey Beans"));
        assert_eq!(client.symbol(), String::from_str(&env, "BEANS"));
        assert_eq!(client.decimals(), 0);
    }

    #[test]
    fn test_mint_and_balance() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        assert_eq!(client.balance(&alice), 100);
        assert_eq!(client.total_supply(), 100);

        client.mint(&admin, &alice, &50);
        assert_eq!(client.balance(&alice), 150);
        assert_eq!(client.total_supply(), 150);
    }

    #[test]
    fn test_transfer() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        client.transfer(&alice, &bob, &30);

        assert_eq!(client.balance(&alice), 70);
        assert_eq!(client.balance(&bob), 30);
        // Total supply unchanged by transfer
        assert_eq!(client.total_supply(), 100);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_transfer_insufficient() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&admin, &alice, &10);
        client.transfer(&alice, &bob, &20);
    }

    #[test]
    fn test_burn() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        client.burn(&alice, &40);

        assert_eq!(client.balance(&alice), 60);
        assert_eq!(client.total_supply(), 60);
    }

    #[test]
    fn test_allowance_and_transfer_from() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let spender = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        client.approve(&alice, &spender, &50);
        assert_eq!(client.allowance(&alice, &spender), 50);

        client.transfer_from(&spender, &alice, &bob, &30);
        assert_eq!(client.balance(&alice), 70);
        assert_eq!(client.balance(&bob), 30);
        assert_eq!(client.allowance(&alice, &spender), 20);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_transfer_from_over_allowance() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let spender = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        client.approve(&alice, &spender, &10);
        client.transfer_from(&spender, &alice, &bob, &20);
    }

    #[test]
    fn test_burn_from() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let store = Address::generate(&env);

        client.mint(&admin, &alice, &100);
        client.approve(&alice, &store, &50);
        client.burn_from(&store, &alice, &30);

        assert_eq!(client.balance(&alice), 70);
        assert_eq!(client.allowance(&alice, &store), 20);
        assert_eq!(client.total_supply(), 70);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let (_, client, admin) = setup();
        client.initialize(&admin);
    }

    #[test]
    fn test_events_emitted() {
        let (env, client, admin) = setup();
        use soroban_sdk::testutils::Events;

        let alice = Address::generate(&env);
        client.mint(&admin, &alice, &50);

        let events = env.events().all();
        assert!(!events.is_empty(), "expected mint event");
    }
}
