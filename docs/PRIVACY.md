# Privacy & Data Sovereignty

Privacy is a baseline requirement, not a feature. Trust is not required—the [Project Architecture](ARCHITECTURE.md) guarantees it. Suri is fully compliant with the [Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/), [GDPR](https://gdpr.eu/what-is-gdpr/), and [CCPA](https://oag.ca.gov/privacy/ccpa).

## 1. Zero-Image Storage
**Face images are never stored.**

When a face is detected, the AI converts it into a "vector" (a string of numbers) and discards the original image immediately. The database only ever sees those numbers.

Even if someone stole the hardware, they couldn't reconstruct a face from those numbers.


## 2. Where Data Lives (The "Split-Brain" Model)
A hybrid approach balances **Security** and **Convenience**.

### A. Biometric Data (Face Embeddings)
*   **Location**: Strictly on the **Local Device**.
*   **Sync**: If Cloud Sync is enabled, this data is **End-to-End Encrypted (E2EE)** before leaving the device.
*   **The Guarantee**: The Cloud Provider receives only a blob of encrypted text. Decryption by the service provider is impossible. The Web Dashboard cannot display it. It is useless to anyone but the owner.

### B. Attendance Logs (Names & Times)
*   **Location**: Synced to the Cloud in a **Readable Format**.
*   **Why?**: This allows the Web Dashboard to display charts, "Who is Present" lists, and export reports from anywhere.
*   **Access**: This data is protected by login credentials, but is *technically visible* to the database engine for query execution.

## 3. Data Sovereignty
*   **Offline First**: Suri works 100% offline using a local [SQLite](https://www.sqlite.org/index.html) database. Sync is optional.
*   **Data Transparency**: In development, persistent data is stored in the project's root `/data` folder. In production, it follows OS standards (e.g., `%LOCALAPPDATA%` on Windows).
*   **No Telemetry**: App usage metrics and button interactions are not tracked.
*   **Encryption Keys**: Encryption is derived from the Master Password. If lost, biometric backups are unrecoverable. Password reset is impossible.


## 4. Compliance & Open Source
*   **GDPR / CCPA**: The user is the data controller. The service acts as the processor (only if Sync is on). Data deletion is available via a single click.
*   **Open Source**: Suri is licensed under [AGPL-3.0](../LICENSE.txt). The code is available for audit to verify transmitted data. There are no hidden "phone home" signals.

## Recommended Security
For maximum safety, encrypting the physical disk is recommended:
1.  **Windows**: Enable [BitLocker](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/bitlocker-overview).
2.  **macOS**: Enable [FileVault](https://support.apple.com/en-us/HT204837).
