CREATE TABLE "chat_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_story_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"code" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_stories" ADD CONSTRAINT "chat_stories_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_stories" ADD CONSTRAINT "chat_stories_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_story_versions" ADD CONSTRAINT "chat_story_versions_story_id_chat_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."chat_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_story_versions" ADD CONSTRAINT "chat_story_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_stories_chat_slug_unique" ON "chat_stories" USING btree ("chat_id","slug");--> statement-breakpoint
CREATE INDEX "chat_stories_chat_id_idx" ON "chat_stories" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_story_versions_story_version_unique" ON "chat_story_versions" USING btree ("story_id","version");--> statement-breakpoint
CREATE INDEX "chat_story_versions_story_id_idx" ON "chat_story_versions" USING btree ("story_id");