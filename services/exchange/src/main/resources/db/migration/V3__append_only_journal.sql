CREATE TRIGGER journal_no_update BEFORE UPDATE ON journal FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Journal is append-only; use a correction entry';
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journal FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Journal is append-only; use a correction entry';
CREATE TRIGGER postings_no_update BEFORE UPDATE ON postings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Postings are append-only; use a correction entry';
CREATE TRIGGER postings_no_delete BEFORE DELETE ON postings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Postings are append-only; use a correction entry';
