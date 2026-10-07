CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand" text NOT NULL,
	"name" text NOT NULL,
	"size_label" text NOT NULL,
	"image_path" text NOT NULL,
	"image_alt" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"msrp_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "catalog_items_cost_cents_not_negative" CHECK ("catalog_items"."cost_cents" >= 0),
	CONSTRAINT "catalog_items_msrp_cents_not_negative" CHECK ("catalog_items"."msrp_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb,
	CONSTRAINT "order_events_actor_type_known" CHECK ("order_events"."actor_type" IN ('provider', 'patient', 'sweep', 'system')),
	CONSTRAINT "order_events_system_has_no_actor" CHECK (NOT ("order_events"."actor_type" IN ('sweep', 'system')) OR ("order_events"."actor_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"frozen_at" timestamp with time zone,
	"unit_cost_cents" integer,
	"fee_rate_bps" integer,
	"unit_fee_cents" integer,
	"unit_margin_cents" integer,
	"unit_msrp_cents" integer,
	"product_name" text,
	"image_path" text,
	"image_alt" text,
	CONSTRAINT "order_lines_one_per_product" UNIQUE("order_id","catalog_item_id"),
	CONSTRAINT "order_lines_quantity_range" CHECK ("order_lines"."quantity" BETWEEN 1 AND 10),
	CONSTRAINT "order_lines_unit_price_cents_not_negative" CHECK ("order_lines"."unit_price_cents" >= 0),
	CONSTRAINT "order_lines_unit_cost_cents_not_negative" CHECK ("order_lines"."unit_cost_cents" >= 0),
	CONSTRAINT "order_lines_unit_fee_cents_not_negative" CHECK ("order_lines"."unit_fee_cents" >= 0),
	CONSTRAINT "order_lines_unit_margin_cents_not_negative" CHECK ("order_lines"."unit_margin_cents" >= 0),
	CONSTRAINT "order_lines_unit_msrp_cents_not_negative" CHECK ("order_lines"."unit_msrp_cents" >= 0),
	CONSTRAINT "order_lines_fee_rate_bps_range" CHECK ("order_lines"."fee_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "order_lines_frozen_complete" CHECK (NOT ("order_lines"."frozen_at" IS NOT NULL) OR (num_nulls("order_lines"."unit_cost_cents", "order_lines"."fee_rate_bps", "order_lines"."unit_fee_cents", "order_lines"."unit_margin_cents", "order_lines"."unit_msrp_cents", "order_lines"."product_name", "order_lines"."image_path", "order_lines"."image_alt") = 0)),
	CONSTRAINT "order_lines_frozen_adds_up" CHECK (NOT ("order_lines"."frozen_at" IS NOT NULL) OR ("order_lines"."unit_cost_cents" + "order_lines"."unit_fee_cents" + "order_lines"."unit_margin_cents" = "order_lines"."unit_price_cents")),
	CONSTRAINT "order_lines_frozen_fee_right" CHECK (NOT ("order_lines"."frozen_at" IS NOT NULL) OR ("order_lines"."unit_fee_cents" = ("order_lines"."unit_price_cents"::bigint * "order_lines"."fee_rate_bps" + 9999) / 10000)),
	CONSTRAINT "order_lines_frozen_in_range" CHECK (NOT ("order_lines"."frozen_at" IS NOT NULL) OR ("order_lines"."unit_margin_cents" >= 0 AND "order_lines"."unit_price_cents" <= "order_lines"."unit_msrp_cents"))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ref" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"practice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_order_id" uuid,
	"status" text NOT NULL,
	"link_version" integer,
	"link_expires_at" timestamp with time zone,
	"fee_rate_bps" integer,
	"total_cents" integer,
	"cost_cents" integer,
	"fee_cents" integer,
	"margin_cents" integer,
	"paid_attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_ref_unique" UNIQUE("ref"),
	CONSTRAINT "orders_status_known" CHECK ("orders"."status" IN ('draft', 'sent', 'needs_review', 'paid', 'cancelled')),
	CONSTRAINT "orders_total_cents_not_negative" CHECK ("orders"."total_cents" >= 0),
	CONSTRAINT "orders_cost_cents_not_negative" CHECK ("orders"."cost_cents" >= 0),
	CONSTRAINT "orders_fee_cents_not_negative" CHECK ("orders"."fee_cents" >= 0),
	CONSTRAINT "orders_margin_cents_not_negative" CHECK ("orders"."margin_cents" >= 0),
	CONSTRAINT "orders_fee_rate_bps_range" CHECK ("orders"."fee_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "orders_link_version_positive" CHECK ("orders"."link_version" >= 1),
	CONSTRAINT "orders_totals_add_up" CHECK ("orders"."cost_cents" + "orders"."fee_cents" + "orders"."margin_cents" = "orders"."total_cents"),
	CONSTRAINT "orders_sent_has_sent_at" CHECK (NOT ("orders"."status" IN ('sent', 'needs_review', 'paid')) OR ("orders"."sent_at" IS NOT NULL)),
	CONSTRAINT "orders_draft_not_sent" CHECK (NOT ("orders"."status" = 'draft') OR ("orders"."sent_at" IS NULL)),
	CONSTRAINT "orders_send_fields_set" CHECK (NOT ("orders"."sent_at" IS NOT NULL) OR (num_nulls("orders"."fee_rate_bps", "orders"."link_version", "orders"."link_expires_at", "orders"."total_cents", "orders"."cost_cents", "orders"."fee_cents", "orders"."margin_cents") = 0)),
	CONSTRAINT "orders_cancelled_has_cancelled_at" CHECK (("orders"."status" = 'cancelled') = ("orders"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "orders_paid_has_payment" CHECK (("orders"."status" = 'paid') = ("orders"."paid_attempt_id" IS NOT NULL) AND ("orders"."status" = 'paid') = ("orders"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"charge_ref" text,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payment_attempts_order_id_id_unique" UNIQUE("order_id","id"),
	CONSTRAINT "payment_attempts_amount_cents_not_negative" CHECK ("payment_attempts"."amount_cents" >= 0),
	CONSTRAINT "payment_attempts_status_known" CHECK ("payment_attempts"."status" IN ('pending', 'succeeded', 'declined', 'failed')),
	CONSTRAINT "payment_attempts_settled_by_known" CHECK ("payment_attempts"."settled_by" IN ('request', 'sweep')),
	CONSTRAINT "payment_attempts_success_has_charge_ref" CHECK (NOT ("payment_attempts"."status" = 'succeeded') OR ("payment_attempts"."charge_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"practice_id" uuid NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_items" (
	"provider_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"usual_price_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_items_pkey" PRIMARY KEY("provider_id","catalog_item_id"),
	CONSTRAINT "store_items_usual_price_cents_not_negative" CHECK ("store_items"."usual_price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_attempt_fk" FOREIGN KEY ("id","paid_attempt_id") REFERENCES "public"."payment_attempts"("order_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_at_idx" ON "order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_provider_created_idx" ON "orders" USING btree ("provider_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_provider_sent_idx" ON "orders" USING btree ("provider_id","sent_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_provider_paid_idx" ON "orders" USING btree ("provider_id","paid_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_pay_key_once" ON "payment_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_attempt_per_order" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" IN ('pending', 'succeeded');--> statement-breakpoint
CREATE INDEX "payment_attempts_pending_created_idx" ON "payment_attempts" USING btree ("created_at") WHERE "payment_attempts"."status" = 'pending';