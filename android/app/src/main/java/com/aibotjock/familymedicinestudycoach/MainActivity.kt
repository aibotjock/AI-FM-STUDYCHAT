package com.aibotjock.familymedicinestudycoach

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import java.io.ByteArrayInputStream
import org.json.JSONObject

/** A phone shell for the existing HTTPS application, not a clinical device. */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var root: LinearLayout
    private lateinit var billing: PlayBillingController
    private var bridgeReply: JavaScriptReplyProxy? = null
    private var documentEpoch = 0L
    private var backCallback: OnBackInvokedCallback? = null
    private val applicationUri = Uri.parse(BuildConfig.APP_URL)
    private val allowedOrigin = "https://${applicationUri.host?.lowercase(java.util.Locale.ROOT)}"
    private val bridgeScript by lazy { assets.open("billing-bridge.js").bufferedReader().use { it.readText() } }

    private fun isApplicationOrigin(uri: Uri?): Boolean = uri != null &&
        uri.scheme == "https" && uri.host.equals(applicationUri.host, ignoreCase = true) &&
        uri.port in listOf(-1, 443) && uri.userInfo == null

    private fun blockedResponse(): WebResourceResponse = WebResourceResponse(
        "text/plain", "UTF-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream("This request is outside the application origin.".toByteArray(Charsets.UTF_8)))

    private fun intercept(request: WebResourceRequest): WebResourceResponse? =
        if (isApplicationOrigin(request.url)) null else blockedResponse()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(isApplicationOrigin(applicationUri)) { "An HTTPS application origin is required." }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(247, 249, 247))
        }
        setContentView(root)
        // shouldOverrideUrlLoading does not intercept POST navigations. Enforce
        // the same origin at the request layer, including service-worker requests.
        ServiceWorkerController.getInstance().apply {
            serviceWorkerWebSettings.allowFileAccess = false
            serviceWorkerWebSettings.allowContentAccess = false
            setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = intercept(request)
            })
        }
        // Android 15+ enforces edge-to-edge. Keep both system bars and keyboard
        // clear of the web controls without depending on a WebView CSS workaround.
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mediaPlaybackRequiresUserGesture = true
            settings.safeBrowsingEnabled = true
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webChromeClient = object : WebChromeClient() {
                // Version one uses the phone keyboard's dictation. No microphone,
                // camera, location, file-upload, or WebRTC permissions are granted.
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = intercept(request)

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    documentEpoch++
                    bridgeReply = null
                    if (::billing.isInitialized) billing.cancelQueuedRequests()
                    // Defense in depth for redirects/POST navigation behavior:
                    // never keep a foreign main document in the privileged view.
                    if (!isApplicationOrigin(Uri.parse(url))) {
                        view.stopLoading()
                        showLoadError("This page is outside the application. Open references in your browser.")
                    }
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (isApplicationOrigin(request.url)) return false
                    if (request.isForMainFrame && request.hasGesture() &&
                        request.url.scheme in setOf("https", "mailto")) openExternal(request.url)
                    // Never load a foreign page or iframe inside the privileged shell.
                    return true
                }

                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    handler.cancel()
                    showLoadError("The secure connection could not be verified. Please try again later.")
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest,
                    error: android.webkit.WebResourceError) {
                    if (request.isForMainFrame) showLoadError("Cannot connect. Check your connection and retry.")
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (isApplicationOrigin(Uri.parse(url)) && isApplicationOrigin(Uri.parse(view.url ?: ""))) {
                        val origin = JSONObject.quote(allowedOrigin)
                        // This is a static wrapper only, with no purchase tokens.
                        // Recheck the document's own origin at execution time.
                        view.evaluateJavascript("if(window.location.origin===$origin){$bridgeScript}", null)
                    }
                }
            }
        }
        billing = PlayBillingController(this, ::emit)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "FamilyMedicineAndroid", setOf(allowedOrigin)) {
                _, message, sourceOrigin, isMainFrame, replyProxy ->
                if (!isMainFrame || !isApplicationOrigin(sourceOrigin) ||
                    message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
                val value = runCatching { message.data }.getOrNull() ?: return@addWebMessageListener
                if (value.length > 16384) return@addWebMessageListener
                val requestEpoch = documentEpoch
                runOnUiThread {
                    if (requestEpoch != documentEpoch || !isApplicationOrigin(Uri.parse(webView.url ?: ""))) return@runOnUiThread
                    try {
                        val request = JSONObject(value)
                        val payload = request.optJSONObject("payload") ?: JSONObject()
                        // ReplyProxy belongs to this specific injected object in
                        // this main frame. Never evaluate purchase tokens as JS.
                        bridgeReply = replyProxy
                        when (request.optString("action")) {
                            "get-product-details" -> billing.queryProducts()
                            "purchase" -> billing.purchase(payload)
                            "restore" -> billing.restore()
                            "manage-subscriptions" -> openExternal(Uri.parse(
                                "https://play.google.com/store/account/subscriptions?sku=${BuildConfig.PLAY_PRODUCT_ID}&package=${BuildConfig.APPLICATION_ID}"))
                            else -> emit(JSONObject().put("type", "billing-error").put("message", "Unsupported billing request."))
                        }
                    } catch (_: Exception) {
                        emit(JSONObject().put("type", "billing-error").put("message", "Invalid billing request."))
                    }
                }
            }
        } else {
            showLoadError("Update Android System WebView to use this app securely.")
            return
        }
        loadApp()
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { navigateBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
    }

    private fun loadApp() {
        root.removeAllViews()
        root.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
        webView.loadUrl(BuildConfig.APP_URL)
        root.requestApplyInsets()
    }

    private fun showLoadError(message: String) = runOnUiThread {
        bridgeReply = null
        root.removeAllViews()
        root.addView(TextView(this).apply {
            text = message
            textSize = 18f
            setPadding(32, 64, 32, 32)
        })
        root.addView(Button(this).apply { text = "Retry"; setOnClickListener { loadApp() } })
    }

    private fun openExternal(uri: Uri) {
        if (uri.scheme !in setOf("https", "mailto")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (_: ActivityNotFoundException) {
            emit(JSONObject().put("type", "billing-error").put("message", "No browser is available to open this link."))
        }
    }

    private fun emit(event: JSONObject) = runOnUiThread {
        if (isFinishing || isDestroyed || !::webView.isInitialized ||
            !isApplicationOrigin(Uri.parse(webView.url ?: ""))) return@runOnUiThread
        val receiver = bridgeReply ?: return@runOnUiThread
        try {
            // The proxy is tied to the requesting frame. A navigation cannot
            // redirect sensitive purchase data to a new foreign document.
            receiver.postMessage(event.toString())
        } catch (_: Exception) {
            // A frame can disappear while billing completes. Restore after the
            // next native-ready event; never log a token or fall back to JS eval.
        }
    }

    override fun onResume() {
        super.onResume()
        if (::billing.isInitialized && bridgeReply != null) billing.restore()
    }

    @Deprecated("Platform back callback used for API 26 compatibility")
    override fun onBackPressed() { navigateBack() }

    private fun navigateBack() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else finish()
    }

    override fun onDestroy() {
        bridgeReply = null
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let {
            onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it)
        }
        if (::billing.isInitialized) billing.close()
        if (::webView.isInitialized) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
                WebViewCompat.removeWebMessageListener(webView, "FamilyMedicineAndroid")
            root.removeAllViews()
            webView.destroy()
        }
        super.onDestroy()
    }
}
