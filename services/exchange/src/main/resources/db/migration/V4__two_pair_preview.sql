-- Preserve historical orders, fills and balances; existing orders remain cancellable.
UPDATE instruments SET state='READ_ONLY', rule_version=2 WHERE symbol='SOLUSDT';
