-- Two rules that §7 implies and the D43 referee found missing. Written by hand,
-- like 0002, because each needs another row: the line's order, or the order's
-- paid attempt. Each raises SQLSTATE 23000 naming its rule.

-- Lines are added only to drafts. Send freezes the lines and then sends the
-- order, and Order again copies lines into a new draft, so neither adds a line
-- to an order that is sent, paid, needing review or cancelled. Without this, a
-- line slipped into a sent order would change what Sam pays.
CREATE FUNCTION order_lines_refuse_insert_unless_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM orders WHERE id = NEW.order_id) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'order % is not a draft, so it cannot take a new line', NEW.order_id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'order_lines_only_on_drafts';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_only_on_drafts
  BEFORE INSERT ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_refuse_insert_unless_draft();
--> statement-breakpoint

-- Paid means a payment that succeeded. The paid-attempt foreign key already
-- refuses an attempt that doesn't exist or belongs to another order; this adds
-- that it succeeded, from both sides: an order can't be paid with an attempt
-- that isn't a success, and the attempt an order was paid with can't stop
-- being one.
CREATE FUNCTION orders_refuse_unsucceeded_paid_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid_attempt_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = NEW.paid_attempt_id AND status <> 'succeeded') THEN
    RAISE EXCEPTION 'order % can only be paid with an attempt that succeeded', NEW.ref
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'orders_paid_attempt_succeeded';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_paid_attempt_succeeded
  BEFORE INSERT OR UPDATE OF paid_attempt_id ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_refuse_unsucceeded_paid_attempt();
--> statement-breakpoint
CREATE FUNCTION payment_attempts_refuse_unsucceeding_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'succeeded' AND NEW.status IS DISTINCT FROM 'succeeded'
     AND EXISTS (SELECT 1 FROM orders WHERE paid_attempt_id = OLD.id) THEN
    RAISE EXCEPTION 'attempt % paid an order, so it stays succeeded', OLD.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'orders_paid_attempt_succeeded';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_paid_stays_succeeded
  BEFORE UPDATE OF status ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION payment_attempts_refuse_unsucceeding_paid();
