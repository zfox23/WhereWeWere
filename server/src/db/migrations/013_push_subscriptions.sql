-- Add push subscriptions table for web push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_is_active ON push_subscriptions(is_active);

-- Optional: track delivery history for debugging
CREATE TABLE IF NOT EXISTS push_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  reminder_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_logs_subscription_id ON push_delivery_logs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_push_delivery_logs_user_id ON push_delivery_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_push_delivery_logs_status ON push_delivery_logs(status);
