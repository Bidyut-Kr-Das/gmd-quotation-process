-- CreateIndex
CREATE INDEX IF NOT EXISTS idx_dqt_thread_id ON docket_quotation_threads(thread_id);
CREATE INDEX IF NOT EXISTS idx_dqt_docket_no ON docket_quotation_threads(docket_no);
CREATE INDEX IF NOT EXISTS idx_dqt_docket_status ON docket_quotation_threads(docket_status);
CREATE INDEX IF NOT EXISTS idx_dqt_is_gmd_client ON docket_quotation_threads(is_gmd_client);
CREATE INDEX IF NOT EXISTS idx_dqt_action_tag ON docket_quotation_threads(action_tag);
CREATE INDEX IF NOT EXISTS idx_dqt_mail_type ON docket_quotation_threads(mail_type);
CREATE INDEX IF NOT EXISTS idx_dqt_date ON docket_quotation_threads(date DESC);
CREATE INDEX IF NOT EXISTS idx_dqt_company ON docket_quotation_threads(company);
