-- Milestone 2B keeps Quality Area mapping optional and reference-only.
-- No regulatory corpus or regulatory assertion is introduced by this seam.
ALTER TABLE audit_template_items
    ADD COLUMN quality_area_reference TEXT
        CHECK (
            quality_area_reference IS NULL
            OR char_length(btrim(quality_area_reference)) BETWEEN 1 AND 100
        );
