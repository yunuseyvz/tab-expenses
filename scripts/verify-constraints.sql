-- Constraint verification. Run against a migrated database.
-- These assert the invariants the plan calls load-bearing, at the database
-- level rather than in application code.

DO $$
DECLARE
  v_space uuid;
  v_user  text := 'constraint-test-user';
  v_me    uuid;
  v_home  uuid;
  v_exp   uuid;
BEGIN
  -- FK from space.created_by_user_id -> user means we need a user row first.
  INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
  VALUES (v_user, 'Constraint Test', 'constraint-test@example.com', true, now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO space (name, currency, created_by_user_id)
  VALUES ('Constraint Test', 'EUR', v_user) RETURNING id INTO v_space;

  INSERT INTO space_member (space_id, user_id, display_name, color, role)
  VALUES (v_space, v_user, 'Me', 'terracotta', 'owner') RETURNING id INTO v_me;

  INSERT INTO category (space_id, name, color, icon, scope)
  VALUES (v_space, 'Home', 'terracotta', 'home', 'shared') RETURNING id INTO v_home;

  -- ── expense.amount_minor > 0 ─────────────────────────────────────────
  BEGIN
    INSERT INTO expense (space_id, category_id, paid_by_member_id, spent_on,
                         purpose, amount_minor, created_by_user_id)
    VALUES (v_space, v_home, v_me, CURRENT_DATE, 'Negative', -100, v_user);
    RAISE EXCEPTION 'FAIL: expense with amount_minor = -100 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: expense.amount_minor > 0 enforced';
  END;

  INSERT INTO expense (space_id, category_id, paid_by_member_id, spent_on,
                       purpose, amount_minor, created_by_user_id)
  VALUES (v_space, v_home, v_me, CURRENT_DATE, 'Valid', 10000, v_user)
  RETURNING id INTO v_exp;

  -- ── expense_split.weight_bp between 1 and 10000 ─────────────────────
  BEGIN
    INSERT INTO expense_split (expense_id, member_id, weight_bp, share_minor)
    VALUES (v_exp, v_me, 0, 0);
    RAISE EXCEPTION 'FAIL: split with weight_bp = 0 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: expense_split.weight_bp >= 1 enforced';
  END;

  BEGIN
    INSERT INTO expense_split (expense_id, member_id, weight_bp, share_minor)
    VALUES (v_exp, v_me, 10001, 0);
    RAISE EXCEPTION 'FAIL: split with weight_bp = 10001 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: expense_split.weight_bp <= 10000 enforced';
  END;

  BEGIN
    INSERT INTO expense_split (expense_id, member_id, weight_bp, share_minor)
    VALUES (v_exp, v_me, 5000, -1);
    RAISE EXCEPTION 'FAIL: split with share_minor = -1 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: expense_split.share_minor >= 0 enforced';
  END;

  -- ── one split row per (expense, member) ─────────────────────────────
  INSERT INTO expense_split (expense_id, member_id, weight_bp, share_minor)
  VALUES (v_exp, v_me, 10000, 10000);

  BEGIN
    INSERT INTO expense_split (expense_id, member_id, weight_bp, share_minor)
    VALUES (v_exp, v_me, 5000, 5000);
    RAISE EXCEPTION 'FAIL: duplicate (expense_id, member_id) was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: one split row per (expense_id, member_id) enforced';
  END;

  -- ── category scope/owner pairing ────────────────────────────────────
  BEGIN
    INSERT INTO category (space_id, name, color, icon, scope, owner_member_id)
    VALUES (v_space, 'BadShared', 'sage', 'leaf', 'shared', v_me);
    RAISE EXCEPTION 'FAIL: shared category with an owner was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: shared category must not name an owner';
  END;

  BEGIN
    INSERT INTO category (space_id, name, color, icon, scope, owner_member_id)
    VALUES (v_space, 'BadPersonal', 'sage', 'leaf', 'personal', NULL);
    RAISE EXCEPTION 'FAIL: personal category without an owner was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: personal category must name an owner';
  END;

  -- ── unique category name per space ──────────────────────────────────
  BEGIN
    INSERT INTO category (space_id, name, color, icon, scope)
    VALUES (v_space, 'Home', 'sage', 'leaf', 'shared');
    RAISE EXCEPTION 'FAIL: duplicate category name in one space was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: category name is unique per space';
  END;

  -- ── one member row per (space, user) ────────────────────────────────
  BEGIN
    INSERT INTO space_member (space_id, user_id, display_name, color, role)
    VALUES (v_space, v_user, 'Me Again', 'sage', 'member');
    RAISE EXCEPTION 'FAIL: duplicate (space_id, user_id) was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: one member row per (space_id, user_id)';
  END;

  -- ── but MANY virtual members (user_id NULL) are allowed ─────────────
  BEGIN
    INSERT INTO space_member (space_id, user_id, display_name, color, role)
    VALUES (v_space, NULL, 'Virtual A', 'sage', 'member'),
           (v_space, NULL, 'Virtual B', 'indigo', 'member');
    RAISE NOTICE 'PASS: multiple virtual members allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'FAIL: virtual members (user_id NULL) collided';
  END;

  -- ── default_weight_bp range ────────────────────────────────────────
  BEGIN
    INSERT INTO space_member (space_id, user_id, display_name, color, default_weight_bp)
    VALUES (v_space, NULL, 'Bad Weight', 'sage', 10001);
    RAISE EXCEPTION 'FAIL: default_weight_bp = 10001 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: space_member.default_weight_bp range enforced';
  END;

  -- ── split rows cascade when the expense is deleted ──────────────────
  DELETE FROM expense WHERE id = v_exp;
  IF EXISTS (SELECT 1 FROM expense_split WHERE expense_id = v_exp) THEN
    RAISE EXCEPTION 'FAIL: expense_split rows survived the expense delete';
  END IF;
  RAISE NOTICE 'PASS: expense_split cascades on expense delete';

  -- ── space cascades everything ──────────────────────────────────────
  DELETE FROM space WHERE id = v_space;
  IF EXISTS (SELECT 1 FROM space_member WHERE space_id = v_space) THEN
    RAISE EXCEPTION 'FAIL: space_member survived the space delete';
  END IF;
  IF EXISTS (SELECT 1 FROM category WHERE space_id = v_space) THEN
    RAISE EXCEPTION 'FAIL: category survived the space delete';
  END IF;
  RAISE NOTICE 'PASS: members and categories cascade on space delete';

  DELETE FROM "user" WHERE id = v_user;
  RAISE NOTICE 'ALL CONSTRAINT TESTS PASSED';
END $$;
