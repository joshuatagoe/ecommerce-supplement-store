-- The three database rules in ARCHITECTURE.md §7 that a CHECK can't express.
-- Written by hand, because drizzle-kit doesn't model triggers. Each raises an
-- integrity error (SQLSTATE 23000) that names its rule, the way a CHECK names
-- its constraint, so Orders and the tests can tell which rule refused a write.
-- TRUNCATE doesn't fire row triggers, so a seed can still reset the tables.

-- A frozen line never changes (D27): no UPDATE or DELETE once frozen_at is set.
CREATE FUNCTION order_lines_refuse_frozen_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'order line % was frozen at Send and cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'order_lines_frozen_never_change';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_frozen_never_change
  BEFORE UPDATE OR DELETE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_refuse_frozen_change();
--> statement-breakpoint

-- Order totals never change after Send: once sent_at is set, the four totals
-- and the fee rate stay what Sam saw. Everything else can still change, for
-- New link, Cancel order and Pay.
CREATE FUNCTION orders_refuse_totals_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL
     AND (NEW.total_cents, NEW.cost_cents, NEW.fee_cents, NEW.margin_cents, NEW.fee_rate_bps)
         IS DISTINCT FROM (OLD.total_cents, OLD.cost_cents, OLD.fee_cents, OLD.margin_cents, OLD.fee_rate_bps) THEN
    RAISE EXCEPTION 'order % was sent, so its totals and fee rate cannot change', OLD.ref
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'orders_totals_frozen';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_totals_frozen
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_refuse_totals_change();
--> statement-breakpoint

-- The audit trail is append-only.
CREATE FUNCTION order_events_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order events are append-only'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'order_events_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION order_events_refuse_change();
