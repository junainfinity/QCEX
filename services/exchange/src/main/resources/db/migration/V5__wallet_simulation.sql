CREATE TABLE wallet_movements (
 id VARCHAR(36) PRIMARY KEY,
 owner_id VARCHAR(36) NOT NULL,
 asset VARCHAR(12) NOT NULL,
 kind VARCHAR(16) NOT NULL,
 amount DECIMAL(28,8) NOT NULL,
 network VARCHAR(24) NOT NULL,
 address VARCHAR(100) NOT NULL,
 state VARCHAR(24) NOT NULL,
 created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX wallet_movement_owner ON wallet_movements(owner_id,created_at);
