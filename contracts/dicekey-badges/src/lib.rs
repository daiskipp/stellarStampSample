#![no_std]

use dicekey_shared::{self as shared, TokenMeta};
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone)]
enum BadgeKey {
    Badge(Address, String), // (user, kind) -> Badge
    BadgeKinds(Address),    // user -> Vec<String> of badge kinds
    BadgeCount(Address),
    NextId,
    Initialized,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Badge {
    pub id: u64,
    pub owner: Address,
    pub kind: String,
    pub awarded_at: u64,
    pub meta: TokenMeta,
}

#[contract]
pub struct DicekeyBadges;

#[contractimpl]
impl DicekeyBadges {
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().instance().has(&BadgeKey::Initialized),
            "already initialized"
        );
        shared::set_admin(&env, &admin);
        env.storage().instance().set(&BadgeKey::NextId, &0u64);
        env.storage()
            .instance()
            .set(&BadgeKey::Initialized, &true);
    }

    /// Read-only: whether `initialize()` has been called on this contract.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&BadgeKey::Initialized)
    }

    // ── SEP-50 NFT Interface (Soulbound) ───────────────

    pub fn name(env: Env) -> String {
        String::from_str(&env, "dicekey Badges")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "DICEKEY-BADGE")
    }

    pub fn balance(env: Env, owner: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&BadgeKey::BadgeCount(owner))
            .unwrap_or(0)
    }

    /// Transfer is blocked — badges are Soulbound Tokens.
    pub fn transfer(_env: Env, _from: Address, _to: Address, _kind: String) {
        panic!("badges are non-transferable (SBT)");
    }

    // ── Issue ──────────────────────────────────────────

    /// Issue a badge (SBT) to a customer. Only callable by admin.
    /// Each kind can only be awarded once per user.
    pub fn issue(env: Env, admin: Address, to: Address, kind: String) -> u64 {
        shared::require_admin(&env, &admin);

        let key = BadgeKey::Badge(to.clone(), kind.clone());
        assert!(
            !env.storage().persistent().has(&key),
            "badge already awarded"
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&BadgeKey::NextId)
            .unwrap_or(0);

        let meta = TokenMeta {
            name: kind.clone(),
            description: String::from_str(&env, "dicekey Coffee Badge"),
            image_uri: String::from_str(&env, ""),
            extra_uri: String::from_str(&env, ""),
        };

        let badge = Badge {
            id,
            owner: to.clone(),
            kind: kind.clone(),
            awarded_at: env.ledger().timestamp(),
            meta,
        };

        env.storage().persistent().set(&key, &badge);

        // Add to user's badge kinds list
        let mut kinds: Vec<String> = env
            .storage()
            .persistent()
            .get(&BadgeKey::BadgeKinds(to.clone()))
            .unwrap_or(Vec::new(&env));
        kinds.push_back(kind.clone());
        env.storage()
            .persistent()
            .set(&BadgeKey::BadgeKinds(to.clone()), &kinds);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&BadgeKey::BadgeCount(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BadgeKey::BadgeCount(to.clone()), &(count + 1));

        env.storage()
            .instance()
            .set(&BadgeKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("badge"), symbol_short!("issued")),
            (to, kind, id),
        );

        id
    }

    // ── Query ──────────────────────────────────────────

    pub fn has_badge(env: Env, owner: Address, kind: String) -> bool {
        env.storage()
            .persistent()
            .has(&BadgeKey::Badge(owner, kind))
    }

    pub fn badge_count(env: Env, owner: Address) -> u64 {
        Self::balance(env, owner)
    }

    pub fn get_badge(env: Env, owner: Address, kind: String) -> Badge {
        env.storage()
            .persistent()
            .get(&BadgeKey::Badge(owner, kind))
            .expect("badge not found")
    }

    /// List all badge kinds owned by a user.
    pub fn list_badges(env: Env, owner: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&BadgeKey::BadgeKinds(owner))
            .unwrap_or(Vec::new(&env))
    }

    /// Total badges ever issued.
    pub fn total_issued(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&BadgeKey::NextId)
            .unwrap_or(0)
    }
}

// ── Tests ──────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, DicekeyBadgesClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(DicekeyBadges, ());
        let client = DicekeyBadgesClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn test_name_symbol() {
        let (env, client, _) = setup();
        assert_eq!(client.name(), String::from_str(&env, "dicekey Badges"));
        assert_eq!(client.symbol(), String::from_str(&env, "DICEKEY-BADGE"));
    }

    #[test]
    fn test_issue_badge() {
        let (env, client, admin) = setup();
        let customer = Address::generate(&env);

        let kind = String::from_str(&env, "coffee_master");
        let id = client.issue(&admin, &customer, &kind);

        assert_eq!(id, 0);
        assert!(client.has_badge(&customer, &kind));
        assert_eq!(client.badge_count(&customer), 1);
        assert_eq!(client.balance(&customer), 1);

        let badge = client.get_badge(&customer, &kind);
        assert_eq!(badge.owner, customer);
    }

    #[test]
    fn test_multiple_badges() {
        let (env, client, admin) = setup();
        let customer = Address::generate(&env);

        let k1 = String::from_str(&env, "coffee_master");
        let k2 = String::from_str(&env, "morning_master");
        let k3 = String::from_str(&env, "spring_2026");

        client.issue(&admin, &customer, &k1);
        client.issue(&admin, &customer, &k2);
        client.issue(&admin, &customer, &k3);

        assert_eq!(client.badge_count(&customer), 3);

        let kinds = client.list_badges(&customer);
        assert_eq!(kinds.len(), 3);
        assert_eq!(kinds.get(0).unwrap(), k1);
        assert_eq!(kinds.get(1).unwrap(), k2);
        assert_eq!(kinds.get(2).unwrap(), k3);
    }

    #[test]
    #[should_panic(expected = "badge already awarded")]
    fn test_no_duplicate_badge() {
        let (env, client, admin) = setup();
        let customer = Address::generate(&env);
        let kind = String::from_str(&env, "coffee_master");

        client.issue(&admin, &customer, &kind);
        client.issue(&admin, &customer, &kind);
    }

    #[test]
    #[should_panic(expected = "non-transferable")]
    fn test_transfer_blocked() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let kind = String::from_str(&env, "coffee_master");

        client.issue(&admin, &alice, &kind);
        client.transfer(&alice, &bob, &kind);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let (_, client, admin) = setup();
        client.initialize(&admin);
    }

    #[test]
    fn test_total_issued() {
        let (env, client, admin) = setup();
        let c1 = Address::generate(&env);
        let c2 = Address::generate(&env);

        let k1 = String::from_str(&env, "badge_a");
        let k2 = String::from_str(&env, "badge_b");

        client.issue(&admin, &c1, &k1);
        client.issue(&admin, &c2, &k2);
        assert_eq!(client.total_issued(), 2);
    }

    #[test]
    fn test_event_emitted() {
        let (env, client, admin) = setup();
        use soroban_sdk::testutils::Events;

        let customer = Address::generate(&env);
        let kind = String::from_str(&env, "coffee_master");
        client.issue(&admin, &customer, &kind);

        let events = env.events().all();
        assert!(!events.is_empty());
    }
}
