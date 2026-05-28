#![no_std]

use dicekey_shared::{self as shared, TokenMeta};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, TryIntoVal, Vec,
};

// Beans per visit (constant)
const BEANS_PER_VISIT: i128 = 10;

// Storage keys
#[contracttype]
#[derive(Clone)]
pub enum StampKey {
    StampCount(Address),         // user -> total stamp count
    Stamp(Address, u64),         // (user, id) -> VisitStamp
    VenueCount(Address, String), // (user, venue) -> count at that venue
    NextId,                      // global auto-increment
    Initialized,                 // initialization guard
    BeansContract,               // address of dicekey-beans-token
    PolicyContract,              // address of dicekey-reward-policy
}

// The core stamp data stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VisitStamp {
    pub id: u64,
    pub owner: Address,
    pub venue: String,
    pub timestamp: u64,
    pub meta: TokenMeta,
}

#[contract]
pub struct DicekeyVisitStamps;

#[contractimpl]
impl DicekeyVisitStamps {
    // ── Admin ──────────────────────────────────────────

    /// Initialize the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().instance().has(&StampKey::Initialized),
            "already initialized"
        );
        shared::set_admin(&env, &admin);
        env.storage().instance().set(&StampKey::NextId, &0u64);
        env.storage()
            .instance()
            .set(&StampKey::Initialized, &true);
    }

    /// Read-only: whether `initialize()` has been called on this contract.
    /// Used by the host-browser HQ setup UI to avoid trapping when contracts
    /// are reused across HQ wallets (see scripts/setup pipeline).
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&StampKey::Initialized)
    }

    /// Set the beans-token contract address for auto-minting.
    /// Only callable by admin.
    pub fn set_beans_contract(env: Env, admin: Address, beans_contract: Address) {
        shared::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&StampKey::BeansContract, &beans_contract);
    }

    /// Set the reward-policy contract address for auto-evaluation.
    /// Only callable by admin.
    pub fn set_policy_contract(env: Env, admin: Address, policy_contract: Address) {
        shared::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&StampKey::PolicyContract, &policy_contract);
    }

    // ── Issuance ───────────────────────────────────────

    /// Issue a visit stamp to a customer.
    /// Only callable by the admin (dicekey Smart Account).
    /// Auto-mints 10 dicekey beans if beans contract is configured.
    /// Auto-evaluates policies if policy contract is configured.
    /// Emits a `stamp_issued` event.
    pub fn issue(env: Env, admin: Address, to: Address, venue: String) -> u64 {
        shared::require_admin(&env, &admin);

        let id: u64 = env
            .storage()
            .instance()
            .get(&StampKey::NextId)
            .unwrap_or(0);
        let timestamp = env.ledger().timestamp();

        let meta = TokenMeta {
            name: String::from_str(&env, "dicekey Visit Stamp"),
            description: String::from_str(&env, "Visit record at dicekey Coffee"),
            image_uri: String::from_str(&env, ""),
            extra_uri: String::from_str(&env, ""),
        };

        let stamp = VisitStamp {
            id,
            owner: to.clone(),
            venue: venue.clone(),
            timestamp,
            meta,
        };

        // Store the stamp
        env.storage()
            .persistent()
            .set(&StampKey::Stamp(to.clone(), id), &stamp);

        // Increment total count
        let count: u64 = env
            .storage()
            .persistent()
            .get(&StampKey::StampCount(to.clone()))
            .unwrap_or(0);
        let new_count = count + 1;
        env.storage()
            .persistent()
            .set(&StampKey::StampCount(to.clone()), &new_count);

        // Increment per-venue count
        let venue_count: u64 = env
            .storage()
            .persistent()
            .get(&StampKey::VenueCount(to.clone(), venue.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&StampKey::VenueCount(to.clone(), venue), &(venue_count + 1));

        // Advance global ID
        env.storage()
            .instance()
            .set(&StampKey::NextId, &(id + 1));

        // Auto-mint beans if beans contract is configured
        if let Some(beans_addr) = env
            .storage()
            .instance()
            .get::<StampKey, Address>(&StampKey::BeansContract)
        {
            env.invoke_contract::<()>(
                &beans_addr,
                &soroban_sdk::Symbol::new(&env, "mint"),
                (admin.clone(), to.clone(), BEANS_PER_VISIT).try_into_val(&env).unwrap(),
            );
        }

        // Emit event for PolicyEngine and frontend
        env.events()
            .publish((symbol_short!("stamp"), symbol_short!("issued")), (to.clone(), id, timestamp));

        // Auto-evaluate policies if policy contract is configured
        if let Some(policy_addr) = env
            .storage()
            .instance()
            .get::<StampKey, Address>(&StampKey::PolicyContract)
        {
            // Pass the freshly-computed count instead of having the policy
            // contract call back into visit-stamps (Soroban forbids contract
            // re-entry: issue → on_stamp_issued → stamp_count would trap).
            env.invoke_contract::<u32>(
                &policy_addr,
                &soroban_sdk::Symbol::new(&env, "on_stamp_issued"),
                (admin, to, new_count).try_into_val(&env).unwrap(),
            );
        }

        id
    }

    // ── SEP-50 NFT interface (Soulbound) ───────────────

    /// Name of this NFT collection.
    pub fn name(env: Env) -> String {
        String::from_str(&env, "dicekey Visit Stamps")
    }

    /// Symbol of this NFT collection.
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "DICEKEY-VISIT")
    }

    /// Token URI for a given stamp. Returns JSON metadata URI.
    pub fn token_uri(env: Env, owner: Address, id: u64) -> String {
        let stamp: VisitStamp = env
            .storage()
            .persistent()
            .get(&StampKey::Stamp(owner, id))
            .expect("stamp not found");
        stamp.meta.extra_uri
    }

    /// Balance (number of stamps) for an owner.
    pub fn balance(env: Env, owner: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&StampKey::StampCount(owner))
            .unwrap_or(0)
    }

    /// Transfer is blocked — visit stamps are Soulbound Tokens.
    pub fn transfer(_env: Env, _from: Address, _to: Address, _id: u64) {
        panic!("visit stamps are non-transferable (SBT)");
    }

    // ── Query ──────────────────────────────────────────

    /// Get the total stamp count for a user.
    pub fn stamp_count(env: Env, owner: Address) -> u64 {
        Self::balance(env, owner)
    }

    /// Get the stamp count for a user at a specific venue.
    pub fn venue_count(env: Env, owner: Address, venue: String) -> u64 {
        env.storage()
            .persistent()
            .get(&StampKey::VenueCount(owner, venue))
            .unwrap_or(0)
    }

    /// Get a specific stamp by owner and sequential ID.
    pub fn get_stamp(env: Env, owner: Address, id: u64) -> VisitStamp {
        env.storage()
            .persistent()
            .get(&StampKey::Stamp(owner, id))
            .expect("stamp not found")
    }

    /// List stamps for a user (paginated). Returns up to `limit` stamps
    /// starting from `offset`.
    pub fn list_stamps(env: Env, owner: Address, offset: u64, limit: u64) -> Vec<VisitStamp> {
        let total = Self::stamp_count(env.clone(), owner.clone());
        let mut result: Vec<VisitStamp> = Vec::new(&env);
        let end = core::cmp::min(offset + limit, total);
        let mut i = offset;
        while i < end {
            if let Some(stamp) = env
                .storage()
                .persistent()
                .get(&StampKey::Stamp(owner.clone(), i))
            {
                result.push_back(stamp);
            }
            i += 1;
        }
        result
    }

    /// Total number of stamps issued across all users.
    pub fn total_issued(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&StampKey::NextId)
            .unwrap_or(0)
    }
}

// ── Tests ──────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::Env;

    fn setup() -> (Env, DicekeyVisitStampsClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(DicekeyVisitStamps, ());
        let client = DicekeyVisitStampsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let customer = Address::generate(&env);

        client.initialize(&admin);
        (env, client, admin, customer)
    }

    #[test]
    fn test_issue_and_count() {
        let (_env, client, admin, customer) = setup();

        let venue = String::from_str(&_env, "shibuya");
        let id = client.issue(&admin, &customer, &venue);
        assert_eq!(id, 0);
        assert_eq!(client.stamp_count(&customer), 1);
        assert_eq!(client.balance(&customer), 1);
        assert_eq!(client.venue_count(&customer, &venue), 1);

        let id2 = client.issue(&admin, &customer, &venue);
        assert_eq!(id2, 1);
        assert_eq!(client.stamp_count(&customer), 2);
        assert_eq!(client.venue_count(&customer, &venue), 2);
    }

    #[test]
    fn test_multiple_venues() {
        let (env, client, admin, customer) = setup();

        let shibuya = String::from_str(&env, "shibuya");
        let shinjuku = String::from_str(&env, "shinjuku");

        client.issue(&admin, &customer, &shibuya);
        client.issue(&admin, &customer, &shinjuku);
        client.issue(&admin, &customer, &shibuya);

        assert_eq!(client.stamp_count(&customer), 3);
        assert_eq!(client.venue_count(&customer, &shibuya), 2);
        assert_eq!(client.venue_count(&customer, &shinjuku), 1);
    }

    #[test]
    fn test_get_stamp() {
        let (env, client, admin, customer) = setup();
        let venue = String::from_str(&env, "kyoto");
        let id = client.issue(&admin, &customer, &venue);

        let stamp = client.get_stamp(&customer, &id);
        assert_eq!(stamp.id, 0);
        assert_eq!(stamp.owner, customer);
        assert_eq!(stamp.venue, venue);
    }

    #[test]
    fn test_list_stamps_pagination() {
        let (env, client, admin, customer) = setup();
        let venue = String::from_str(&env, "shibuya");

        for _ in 0..5 {
            client.issue(&admin, &customer, &venue);
        }

        let page1 = client.list_stamps(&customer, &0, &3);
        assert_eq!(page1.len(), 3);
        assert_eq!(page1.get(0).unwrap().id, 0);
        assert_eq!(page1.get(2).unwrap().id, 2);

        let page2 = client.list_stamps(&customer, &3, &3);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().id, 3);
    }

    #[test]
    fn test_total_issued() {
        let (env, client, admin, _) = setup();
        let c1 = Address::generate(&env);
        let c2 = Address::generate(&env);
        let venue = String::from_str(&env, "shibuya");

        client.issue(&admin, &c1, &venue);
        client.issue(&admin, &c2, &venue);
        client.issue(&admin, &c1, &venue);

        assert_eq!(client.total_issued(), 3);
    }

    #[test]
    fn test_stamp_issued_event() {
        let (env, client, admin, customer) = setup();
        let venue = String::from_str(&env, "shibuya");
        client.issue(&admin, &customer, &venue);

        // Verify events were published (at least one event exists)
        let events = env.events().all();
        assert!(!events.is_empty(), "expected at least one event");
    }

    #[test]
    #[should_panic(expected = "non-transferable")]
    fn test_transfer_blocked() {
        let (env, client, admin, customer) = setup();
        let venue = String::from_str(&env, "shibuya");
        client.issue(&admin, &customer, &venue);

        let other = Address::generate(&env);
        client.transfer(&customer, &other, &0);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let (_, client, admin, _) = setup();
        client.initialize(&admin);
    }

    #[test]
    fn test_name_and_symbol() {
        let (env, client, _, _) = setup();
        assert_eq!(client.name(), String::from_str(&env, "dicekey Visit Stamps"));
        assert_eq!(client.symbol(), String::from_str(&env, "DICEKEY-VISIT"));
    }

    #[test]
    fn test_auto_mint_beans_on_issue() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let customer = Address::generate(&env);

        // Deploy beans-token from WASM
        let beans_wasm = dicekey_beans_wasm::WASM;
        let beans_id = env.register(beans_wasm, ());
        let beans_client = dicekey_beans_wasm::Client::new(&env, &beans_id);
        beans_client.initialize(&admin);

        // Deploy visit-stamps and link beans contract
        let stamps_id = env.register(DicekeyVisitStamps, ());
        let stamps_client = DicekeyVisitStampsClient::new(&env, &stamps_id);
        stamps_client.initialize(&admin);
        stamps_client.set_beans_contract(&admin, &beans_id);

        // Issue a stamp
        let venue = String::from_str(&env, "shibuya");
        stamps_client.issue(&admin, &customer, &venue);

        // Verify beans were minted (10 per visit)
        assert_eq!(beans_client.balance(&customer), 10);
        assert_eq!(stamps_client.stamp_count(&customer), 1);

        // Issue another stamp
        stamps_client.issue(&admin, &customer, &venue);
        assert_eq!(beans_client.balance(&customer), 20);
    }
}

// Import beans-token WASM for cross-contract testing
#[cfg(test)]
mod dicekey_beans_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/dicekey_beans_token.wasm"
    );
}
