-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_short_link_id_fkey";

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
