import base from "@impulza/eslint-config";

export default [...base, { ignores: [".playwright/", "playwright-report/"] }];
