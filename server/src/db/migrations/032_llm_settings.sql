-- ============================================================================
-- LLM settings for the "Life Summary" feature (on-network OpenAI-compatible
-- endpoint, e.g. a local vLLM instance).
-- ============================================================================

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_api_url VARCHAR(500);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_model VARCHAR(200);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_reasoning_level VARCHAR(20);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_context_window INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_image_support BOOLEAN;
