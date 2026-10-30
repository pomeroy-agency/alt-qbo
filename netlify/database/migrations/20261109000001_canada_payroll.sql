-- Canadian businesses and their payroll. Entity types for a Canadian sole
-- proprietor, partnership and corporation (T2125, T5013 and T2 returns);
-- room for Revenu Québec's 16-character employer number; Canadian postal
-- codes in addresses; and each employee's TD1 (or Quebec TP-1015.3) claim.

ALTER TABLE entities DROP CONSTRAINT entities_entity_type_check;
ALTER TABLE entities ADD CONSTRAINT entities_entity_type_check
  CHECK (entity_type IN ('sole_prop', 'llc_single', 'llc_partnership', 'llc_s_corp', 's_corp', 'c_corp', 'partnership',
                         'ca_sole_prop', 'ca_partnership', 'ca_corporation'));

-- A CRA payroll account is 15 characters (123456789RP0001); Revenu Québec's is 16 (1234567890RS0001).
ALTER TABLE entities DROP CONSTRAINT entities_state_employer_id_check;
ALTER TABLE entities ADD CONSTRAINT entities_state_employer_id_check
  CHECK (state_employer_id IS NULL OR state_employer_id ~ '^[0-9A-Z]{4,16}$');

-- The business number (123456789) sits where a US business keeps its EIN.

-- A US ZIP code or a Canadian postal code (A1A 1A1).
ALTER TABLE entities DROP CONSTRAINT entities_address_zip_check;
ALTER TABLE entities ADD CONSTRAINT entities_address_zip_check
  CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$' OR address_zip ~ '^[A-Z]\d[A-Z] \d[A-Z]\d$');
ALTER TABLE contacts DROP CONSTRAINT contacts_address_zip_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_address_zip_check
  CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$' OR address_zip ~ '^[A-Z]\d[A-Z] \d[A-Z]\d$');
ALTER TABLE employees DROP CONSTRAINT employees_address_zip_check;
ALTER TABLE employees ADD CONSTRAINT employees_address_zip_check
  CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$' OR address_zip ~ '^[A-Z]\d[A-Z] \d[A-Z]\d$');

-- Claim amounts and exemptions from the employee's federal and provincial TD1
-- (Quebec: TP-1015.3). The SIN is sealed in ssn_sealed like an SSN.
ALTER TABLE employees ADD COLUMN td1 jsonb CHECK (td1 IS NULL OR jsonb_typeof(td1) = 'object');
