#![no_std]

use dicekey_shared as shared;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, TryIntoVal,
};

// ── Storage ────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum PolicyKey {
    VisitStampsContract,
    BenefitsContract,
    BadgesContract,
    Claimed(Address, String), // (user, policy_id) -> bool
    Initialized,
}

// ── Policy definitions (hardcoded for this app) ────────
// In a generic system these would be stored on-chain, but for dicekey Coffee
// we keep it simple: 4 policies, all evaluated on every stamp issue.

const POLICY_10VISIT: &str = "10visit_bonus";
const POLICY_100VISIT: &str = "100visit_master";
// morning_lover and spring_campaign require timestamp data that is
// tracked externally; for Phase 4 we implement the two count-based
// policies fully and stub the time-based ones.

#[contract]
pub struct DicekeyRewardPolicy;

#[contractimpl]
impl DicekeyRewardPolicy {
    /// Initialize with admin and contract references.
    pub fn initialize(
        env: Env,
        admin: Address,
        visit_stamps: Address,
        benefits: Address,
        badges: Address,
    ) {
        assert!(
            !env.storage().instance().has(&PolicyKey::Initialized),
            "already initialized"
        );
        shared::set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&PolicyKey::VisitStampsContract, &visit_stamps);
        env.storage()
            .instance()
            .set(&PolicyKey::BenefitsContract, &benefits);
        env.storage()
            .instance()
            .set(&PolicyKey::BadgesContract, &badges);
        env.storage()
            .instance()
            .set(&PolicyKey::Initialized, &true);
    }

    /// Read-only: whether `initialize()` has been called on this contract.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&PolicyKey::Initialized)
    }

    // ── Core evaluation ────────────────────────────────

    /// Called after a stamp is issued. Evaluates all policies for the user.
    /// Returns the number of rewards granted this invocation.
    /// `stamp_count` is supplied by the caller (visit-stamps.issue) rather than
    /// queried back, because Soroban forbids contract re-entry: the call chain
    /// issue → on_stamp_issued → stamp_count would re-enter visit-stamps and trap.
    pub fn on_stamp_issued(env: Env, admin: Address, user: Address, stamp_count: u64) -> u32 {
        shared::require_admin(&env, &admin);

        let benefits: Address = env
            .storage()
            .instance()
            .get(&PolicyKey::BenefitsContract)
            .expect("not initialized");
        let badges: Address = env
            .storage()
            .instance()
            .get(&PolicyKey::BadgesContract)
            .expect("not initialized");

        let mut rewards_granted: u32 = 0;

        // ── Policy: 10visit_bonus ──────────────────────
        // At 10+ visits, mint a free drink voucher (once per user)
        let policy_10 = String::from_str(&env, POLICY_10VISIT);
        if stamp_count >= 10 && !Self::is_claimed(env.clone(), user.clone(), policy_10.clone()) {
            // Mark claimed FIRST to prevent reentrancy
            Self::mark_claimed(&env, &user, &policy_10);

            // Mint a benefit NFT: free_drink_voucher, no expiry (0)
            let kind = String::from_str(&env, "free_drink_voucher");
            env.invoke_contract::<u64>(
                &benefits,
                &Symbol::new(&env, "mint"),
                (admin.clone(), user.clone(), kind, 0u64)
                    .try_into_val(&env)
                    .unwrap(),
            );

            rewards_granted += 1;

            env.events().publish(
                (symbol_short!("policy"), symbol_short!("reward")),
                (user.clone(), policy_10),
            );
        }

        // ── Policy: 100visit_master ────────────────────
        // At 100+ visits, award "coffee_master" badge (once per user)
        let policy_100 = String::from_str(&env, POLICY_100VISIT);
        if stamp_count >= 100 && !Self::is_claimed(env.clone(), user.clone(), policy_100.clone()) {
            Self::mark_claimed(&env, &user, &policy_100);

            let kind = String::from_str(&env, "coffee_master");
            env.invoke_contract::<u64>(
                &badges,
                &Symbol::new(&env, "issue"),
                (admin.clone(), user.clone(), kind)
                    .try_into_val(&env)
                    .unwrap(),
            );

            rewards_granted += 1;

            env.events().publish(
                (symbol_short!("policy"), symbol_short!("reward")),
                (user.clone(), policy_100),
            );
        }

        // ── Policy: morning_lover ──────────────────────
        // Requires 20 morning visits (6-10am). We can't count these
        // from on-chain stamp data alone without a dedicated morning
        // counter. For Phase 4, we expose a manual trigger that the
        // frontend can call after verifying the morning count off-chain.
        // (see `check_morning_policy` below)

        // ── Policy: spring_campaign ────────────────────
        // Requires 5 visits during Mar 1 - May 31. Same pattern as
        // morning_lover: expose a manual trigger.
        // (see `check_spring_policy` below)

        rewards_granted
    }

    /// Manual trigger for morning_lover policy.
    /// The caller (admin) asserts the user has 20+ morning visits.
    pub fn check_morning_policy(env: Env, admin: Address, user: Address, morning_visits: u64) {
        shared::require_admin(&env, &admin);

        let badges: Address = env
            .storage()
            .instance()
            .get(&PolicyKey::BadgesContract)
            .expect("not initialized");

        let policy_id = String::from_str(&env, "morning_lover");
        if morning_visits >= 20 && !Self::is_claimed(env.clone(), user.clone(), policy_id.clone()) {
            Self::mark_claimed(&env, &user, &policy_id);

            let kind = String::from_str(&env, "morning_master");
            env.invoke_contract::<u64>(
                &badges,
                &Symbol::new(&env, "issue"),
                (admin, user.clone(), kind)
                    .try_into_val(&env)
                    .unwrap(),
            );

            env.events().publish(
                (symbol_short!("policy"), symbol_short!("reward")),
                (user, policy_id),
            );
        }
    }

    /// Manual trigger for spring_campaign policy.
    /// The caller (admin) asserts the user has 5+ spring visits.
    pub fn check_spring_policy(env: Env, admin: Address, user: Address, spring_visits: u64) {
        shared::require_admin(&env, &admin);

        let badges: Address = env
            .storage()
            .instance()
            .get(&PolicyKey::BadgesContract)
            .expect("not initialized");

        let policy_id = String::from_str(&env, "spring_campaign");
        if spring_visits >= 5 && !Self::is_claimed(env.clone(), user.clone(), policy_id.clone()) {
            Self::mark_claimed(&env, &user, &policy_id);

            let kind = String::from_str(&env, "spring_2026");
            env.invoke_contract::<u64>(
                &badges,
                &Symbol::new(&env, "issue"),
                (admin, user.clone(), kind)
                    .try_into_val(&env)
                    .unwrap(),
            );

            env.events().publish(
                (symbol_short!("policy"), symbol_short!("reward")),
                (user, policy_id),
            );
        }
    }

    // ── Query ──────────────────────────────────────────

    /// Check if a user has already claimed a specific policy reward.
    pub fn is_claimed(env: Env, user: Address, policy_id: String) -> bool {
        env.storage()
            .persistent()
            .has(&PolicyKey::Claimed(user, policy_id))
    }

    // ── Internal ───────────────────────────────────────

    fn mark_claimed(env: &Env, user: &Address, policy_id: &String) {
        env.storage()
            .persistent()
            .set(&PolicyKey::Claimed(user.clone(), policy_id.clone()), &true);
    }
}

// ── Tests ──────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    // Import WASM for cross-contract testing
    mod visit_stamps_wasm {
        // Re-export VenueId so generated code can resolve it
        pub use dicekey_shared::VenueId;
        soroban_sdk::contractimport!(
            file = "../../target/wasm32v1-none/release/dicekey_visit_stamps.wasm"
        );
    }
    mod benefits_wasm {
        soroban_sdk::contractimport!(
            file = "../../target/wasm32v1-none/release/dicekey_benefits.wasm"
        );
    }
    mod badges_wasm {
        soroban_sdk::contractimport!(
            file = "../../target/wasm32v1-none/release/dicekey_badges.wasm"
        );
    }

    struct TestEnv {
        env: Env,
        admin: Address,
        customer: Address,
        policy_client: DicekeyRewardPolicyClient<'static>,
        stamps_client: visit_stamps_wasm::Client<'static>,
        benefits_client: benefits_wasm::Client<'static>,
        badges_client: badges_wasm::Client<'static>,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let customer = Address::generate(&env);

        // Deploy all contracts from WASM
        let stamps_id = env.register(visit_stamps_wasm::WASM, ());
        let stamps_client = visit_stamps_wasm::Client::new(&env, &stamps_id);
        stamps_client.initialize(&admin);

        let benefits_id = env.register(benefits_wasm::WASM, ());
        let benefits_client = benefits_wasm::Client::new(&env, &benefits_id);
        benefits_client.initialize(&admin);

        let badges_id = env.register(badges_wasm::WASM, ());
        let badges_client = badges_wasm::Client::new(&env, &badges_id);
        badges_client.initialize(&admin);

        // Deploy policy engine natively (for testing its own logic)
        let policy_id = env.register(DicekeyRewardPolicy, ());
        let policy_client = DicekeyRewardPolicyClient::new(&env, &policy_id);
        policy_client.initialize(&admin, &stamps_id, &benefits_id, &badges_id);

        TestEnv {
            env,
            admin,
            customer,
            policy_client,
            stamps_client,
            benefits_client,
            badges_client,
        }
    }

    #[test]
    fn test_no_reward_below_threshold() {
        let t = setup();
        let venue = String::from_str(&t.env, "shibuya");

        // Issue 5 stamps — below 10 threshold
        for _ in 0..5 {
            t.stamps_client.issue(&t.admin, &t.customer, &venue);
        }

        let granted = t.policy_client.on_stamp_issued(&t.admin, &t.customer, &5);
        assert_eq!(granted, 0);
        assert_eq!(t.benefits_client.balance(&t.customer), 0);
    }

    #[test]
    fn test_10visit_bonus() {
        let t = setup();
        let venue = String::from_str(&t.env, "shibuya");

        // Issue 10 stamps
        for _ in 0..10 {
            t.stamps_client.issue(&t.admin, &t.customer, &venue);
        }

        let granted = t.policy_client.on_stamp_issued(&t.admin, &t.customer, &10);
        assert_eq!(granted, 1);

        // Customer should have a benefit NFT
        assert_eq!(t.benefits_client.balance(&t.customer), 1);

        // Policy should be marked as claimed
        let policy_id = String::from_str(&t.env, "10visit_bonus");
        assert!(t.policy_client.is_claimed(&t.customer, &policy_id));
    }

    #[test]
    fn test_10visit_bonus_not_double_claim() {
        let t = setup();
        let venue = String::from_str(&t.env, "shibuya");

        for _ in 0..15 {
            t.stamps_client.issue(&t.admin, &t.customer, &venue);
        }

        // First evaluation: grants 1
        let g1 = t.policy_client.on_stamp_issued(&t.admin, &t.customer, &15);
        assert_eq!(g1, 1);

        // Second evaluation: grants 0 (already claimed)
        let g2 = t.policy_client.on_stamp_issued(&t.admin, &t.customer, &15);
        assert_eq!(g2, 0);

        // Still only 1 benefit
        assert_eq!(t.benefits_client.balance(&t.customer), 1);
    }

    #[test]
    fn test_100visit_master() {
        let t = setup();
        let venue = String::from_str(&t.env, "shibuya");

        // Issue 100 stamps
        for _ in 0..100 {
            t.stamps_client.issue(&t.admin, &t.customer, &venue);
        }

        let granted = t.policy_client.on_stamp_issued(&t.admin, &t.customer, &100);
        // Should grant 2: 10visit_bonus + 100visit_master
        assert_eq!(granted, 2);

        assert_eq!(t.benefits_client.balance(&t.customer), 1); // free drink
        assert_eq!(t.badges_client.balance(&t.customer), 1);   // coffee_master

        let master_kind = String::from_str(&t.env, "coffee_master");
        assert!(t.badges_client.has_badge(&t.customer, &master_kind));
    }

    #[test]
    fn test_morning_policy() {
        let t = setup();

        // Admin asserts 20 morning visits
        t.policy_client.check_morning_policy(&t.admin, &t.customer, &20);

        let kind = String::from_str(&t.env, "morning_master");
        assert!(t.badges_client.has_badge(&t.customer, &kind));
        assert_eq!(t.badges_client.balance(&t.customer), 1);

        let policy_id = String::from_str(&t.env, "morning_lover");
        assert!(t.policy_client.is_claimed(&t.customer, &policy_id));
    }

    #[test]
    fn test_spring_policy() {
        let t = setup();

        t.policy_client.check_spring_policy(&t.admin, &t.customer, &5);

        let kind = String::from_str(&t.env, "spring_2026");
        assert!(t.badges_client.has_badge(&t.customer, &kind));

        let policy_id = String::from_str(&t.env, "spring_campaign");
        assert!(t.policy_client.is_claimed(&t.customer, &policy_id));
    }

    #[test]
    fn test_spring_policy_below_threshold() {
        let t = setup();

        t.policy_client.check_spring_policy(&t.admin, &t.customer, &3);

        // Should not have badge
        assert_eq!(t.badges_client.balance(&t.customer), 0);
        let policy_id = String::from_str(&t.env, "spring_campaign");
        assert!(!t.policy_client.is_claimed(&t.customer, &policy_id));
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let t = setup();
        let dummy = Address::generate(&t.env);
        t.policy_client.initialize(&t.admin, &dummy, &dummy, &dummy);
    }

    #[test]
    fn test_events_emitted() {
        let t = setup();
        use soroban_sdk::testutils::Events;

        let venue = String::from_str(&t.env, "shibuya");
        for _ in 0..10 {
            t.stamps_client.issue(&t.admin, &t.customer, &venue);
        }
        t.policy_client.on_stamp_issued(&t.admin, &t.customer, &10);

        let events = t.env.events().all();
        assert!(!events.is_empty());
    }
}
