# QuickDrop for Vercel

1. Upload this folder to a new GitHub repository or import it into a new Vercel project.
2. In the Vercel project, open **Storage → Create Database → Upstash Redis**.
3. Connect the database to this project. Vercel will add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` automatically.
4. Redeploy the preview.
5. Test with the same private space key on your phone and computer, then promote it to Production.

## How to move text

1. On your phone, open a private space and paste your text.
2. Tap **Save to space** and wait for the green saved message.
3. On your PC, open the site and enter the exact same private space key.
4. The saved text will load automatically. Tap **Copy text**.

The practical limit is roughly 2 MB of ordinary text per space. Very large documents should be split into smaller parts.

The browser encrypts the text with AES-GCM before the API saves it. The server stores only ciphertext.
