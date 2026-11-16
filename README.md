# Alt Text Generator AI for Storyblok

<img src="https://raw.githubusercontent.com/balt1794/storyblok-alt-text-generator-ai/main/public/logo.png" alt="Alt Text Generator logo" width="64" />

Write SEO-friendly alt text for the images in your Storyblok space. Generate it for one image or in bulk, review it, and save. 131 languages.

[Get a free API key](https://alttextgeneratorai.com/dashboard)

## What you get

- **A page in the Storyblok sidebar.** It lists the images in your space with a preview, shows the ones with no alt text, and writes it for all of them or only the ones you tick.
- **Review before saving.** Edit any text, then save everything at once. The text goes into each asset's **Alt text** field.
- **Nothing is overwritten by accident.** *Generate all missing* skips images that already have alt text.
- **131 languages**, and your credits shown on the page.
- **Your key stays on the server.** The API key is encrypted before it is saved with the space settings, and it never reaches the browser.
- **Respects Storyblok roles.** Only space admins can change the API key.

## Use it

1. Open **Alt Text Generator AI** in the Storyblok sidebar.
2. Paste your API key and click **Save key**.
3. **Missing** shows the images with no alt text. **All** shows everything.
4. Tick the images you want, or click **Generate all missing**. Each image uses 1 credit.
5. Read the results, change anything you like, then click **Save changes**.

## Self-hosting

This is a Storyblok space plugin, so it runs as a small Next.js app.

1. Create a **Space** extension in the Storyblok Partner Portal (or your organization), turn on **Use App Bridge** and **Enable settings on space level**, and set the index page to your app URL and the redirection endpoint to `<app URL>/api/connect/callback`.
2. Copy `.env.local.example` to `.env.local` and fill in:

| Variable | What it is |
| --- | --- |
| `CLIENT_ID`, `CLIENT_SECRET` | From the extension's **OAuth 2.0 and Pages** tab. |
| `BASE_URL` | The public URL of the app. |
| `ENCRYPTION_SECRET` | A long random string. The API key is encrypted with it. |

3. Run it:

```sh
npm install
npm run dev
```

## License

MIT. See [LICENSE](LICENSE).
