# First phone test

Open https://family-medicine-phone-test-private-test.up.railway.app on your phone. In **Study access code**, paste the value of `STUDY_ACCESS_TOKEN` from Railway → `private-test` → `family-medicine-phone-test` → **Variables**. This is separate from `OPENAI_API_KEY`, which is already configured on the server. Do not paste the OpenAI key into the app.

The personal pilot uses OpenAI; Claude is inactive. It does not start a Google Play subscription or require a commercial account. Live status confirms the server key is configured, but successful live sign-in and inference remain unverified. Use [VALIDATION_STATUS.md](VALIDATION_STATUS.md) to focus on outstanding checks; repeat a passing check only when a relevant change or failure justifies it.

1. Open the link in Chrome on Android or Safari on iPhone. Unlock the study space if asked. Start in **Coach**.
2. Type: “Help me synthesize a complex fictional patient. Ask one question at a time.” Send it, answer the next question, and check that the conversation stays readable above the phone navigation.
3. Dictate an answer with your keyboard’s microphone. In a browser that supports it, the app microphone is another option; review the dictated text before sending. The native Android app uses keyboard dictation.
4. Try **Read aloud** on a coach reply. Speech support depends on the device/browser. Confirm you can stop playback by tapping Read aloud again.
5. Save a useful learning point as a card. Write a focused question, check its answer, and add a reference when it contains a medical fact.
6. Open **Review**. Attempt your answer, reveal it, then choose an honest Again/Hard/Good/Easy rating. Check **Progress** to see the completed review.
7. Open **Library → Clinical cases** and start a case. Choose **Coach → History** to return to your first conversation. Reload to check that your study content remains saved.
8. In **Study preferences → Choose or test a model**, choose an available OpenAI text model and press **Use selected model**. Try **Test model connection** once for a model without a saved result, then **Export model results**. A new connection check is a paid API request capped at 512 billed output tokens. Completed results are reused. Confirm the selected model appears on subsequent Coach replies. Astra is prohibited with no exceptions; do not configure or test it.
9. In Study preferences, export a study backup. Install the browser app through your browser’s Add to Home Screen/Install app option if desired.

Use fictional or de-identified cases. This prototype’s educational feedback is not a formal competency evaluation. Phone functionality and model connection checks do not validate clinical accuracy. Ingenium routing is not connected. Keep the access code private: everyone with it can access the same workspace and its owner model controls.

## Separate commercial preparation mode

Commercial mode is optional and separate from the personal pilot. Private pilot registration may require an invite supplied by the owner. The free private pilot is not a paid subscription trial. Subscriber model selection is not enabled. The checked-in reviewed clinical corpus is empty, so commercial clinical coaching abstains until eligible reviewed content is supplied.

Google Play pricing is shown only from actual Play product details in the installed Android app. A purchase unlocks coaching only after server verification. There is no local subscription simulation. Do not test live billing until the owner has configured the product, eligible offers, and a Play license-testing account.

Privacy and account-deletion disclosures are available at `/privacy.html` and `/account-deletion.html`. In commercial mode, the website deletion link lets you sign in, review the deletion message, and confirm with DELETE. Account deletion and Google Play subscription cancellation are separate actions.
