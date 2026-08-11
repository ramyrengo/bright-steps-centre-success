import { appMeta } from "encore.dev";
import {
  QUARTERLY_REVIEW_DEVELOPMENT_IDS,
  seedLocalQuarterlyReviewDevelopmentData,
} from "../foundation/quarterly-reviews/development-seed";

await seedLocalQuarterlyReviewDevelopmentData({
  environment: appMeta().environment,
});

console.info("Synthetic Milestone 2B development data is ready.");
console.info(`organisation-id: ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.organisationId}`);
console.info(`area-manager-principal-id: ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.areaManagerPrincipalId}`);
console.info(`compliance-manager-principal-id: ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.complianceManagerPrincipalId}`);
