UPDATE "KnowledgeDocument"
SET "contentHash" = 'd33b3e47159a2d766cbe813ef7a4b9f979bc7ccba4fbe5d586f801d43a49f06b'
WHERE "source" = 'seed/vpn'
  AND "version" = 1
  AND "contentHash" = 'seed-vpn-document-v1';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "KnowledgeDocument"
        GROUP BY "contentHash"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'KnowledgeDocument contains duplicate contentHash values; deduplicate articles before applying this migration';
    END IF;
END
$$;

CREATE UNIQUE INDEX "KnowledgeDocument_contentHash_key"
ON "KnowledgeDocument"("contentHash");
