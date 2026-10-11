-- D3: o aquecimento conta desde a primeira conexão `connected`. Toda escrita de estado (connect,
-- getStatus, webhook) passa por esta tabela, então o banco grava a data uma única vez: só quando
-- ainda é nula. Reconexão não altera a data já gravada.
CREATE FUNCTION "whatsapp_connections_first_connected"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'connected' AND NEW."first_connected_at" IS NULL THEN
    NEW."first_connected_at" := COALESCE(NEW."last_checked_at", CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "whatsapp_connections_first_connected"
BEFORE INSERT OR UPDATE ON "whatsapp_connections"
FOR EACH ROW EXECUTE FUNCTION "whatsapp_connections_first_connected"();
