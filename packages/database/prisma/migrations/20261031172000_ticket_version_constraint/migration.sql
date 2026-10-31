CREATE UNIQUE INDEX "Ticket_id_employeeId_version_key"
    ON "Ticket"("id", "employeeId", "version");
