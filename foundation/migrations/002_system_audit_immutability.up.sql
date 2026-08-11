CREATE FUNCTION reject_system_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'system audit events are append-only';
END;
$$;

CREATE TRIGGER system_audit_events_reject_update_or_delete
BEFORE UPDATE OR DELETE ON system_audit_events
FOR EACH ROW
EXECUTE FUNCTION reject_system_audit_event_mutation();

