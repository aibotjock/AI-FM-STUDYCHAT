package com.aibotjock.familymedicinestudycoach

import android.app.Activity
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/** Native Play UI and tokens only. The authenticated backend grants access and
 * acknowledges purchases after verification; this class never unlocks a trial. */
class PlayBillingController(private val activity: Activity, private val emit: (JSONObject) -> Unit) {
    private var connecting = false
    private var closed = false
    private var purchaseFlowInProgress = false
    private val queued = mutableListOf<() -> Unit>()
    private var product: ProductDetails? = null
    private val client = BillingClient.newBuilder(activity)
        .setListener { result, purchases ->
            purchaseFlowInProgress = false
            when (result.responseCode) {
                BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach { deliverPurchase(it, "purchase") }
                BillingClient.BillingResponseCode.USER_CANCELED -> emit(JSONObject().put("type", "purchase-canceled"))
                BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> restore()
                else -> error(result)
            }
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private fun ready(action: () -> Unit) {
        if (closed) return
        if (client.isReady) { action(); return }
        if (queued.size >= 16) {
            emit(JSONObject().put("type", "billing-error").put("message", "Please wait for Google Play to connect."))
            return
        }
        queued.add(action)
        if (connecting) return
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                activity.runOnUiThread {
                    connecting = false
                    val pending = queued.toList()
                    queued.clear()
                    if (closed) return@runOnUiThread
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        emit(JSONObject().put("type", "billing-ready"))
                        pending.forEach { it() }
                    } else error(result)
                }
            }
            override fun onBillingServiceDisconnected() { connecting = false }
        })
    }

    fun queryProducts() = ready {
        product = null
        val requested = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(BuildConfig.PLAY_PRODUCT_ID).setProductType(BillingClient.ProductType.SUBS).build()
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(requested)).build()) { result, details ->
            activity.runOnUiThread {
                if (closed) return@runOnUiThread
                if (result.responseCode != BillingClient.BillingResponseCode.OK) { error(result); return@runOnUiThread }
                product = details.productDetailsList.firstOrNull { it.productId == BuildConfig.PLAY_PRODUCT_ID }
                val current = product
                if (current == null) {
                    emit(JSONObject().put("type", "billing-unavailable").put("message", "This subscription is not available from Google Play yet."))
                    return@runOnUiThread
                }
                val offers = JSONArray()
                current.subscriptionOfferDetails.orEmpty().forEach { offer ->
                    val phases = JSONArray()
                    offer.pricingPhases.pricingPhaseList.forEach { phase ->
                        phases.put(JSONObject()
                            .put("formattedPrice", phase.formattedPrice)
                            .put("priceCurrencyCode", phase.priceCurrencyCode)
                            .put("priceAmountMicros", phase.priceAmountMicros)
                            .put("billingPeriod", phase.billingPeriod)
                            .put("recurrenceMode", phase.recurrenceMode)
                            .put("billingCycleCount", phase.billingCycleCount))
                    }
                    offers.put(JSONObject().put("offerToken", offer.offerToken)
                        .put("basePlanId", offer.basePlanId).put("offerId", offer.offerId ?: JSONObject.NULL)
                        .put("pricingPhases", phases))
                }
                emit(JSONObject().put("type", "product-details").put("products", JSONArray().put(
                    JSONObject().put("productId", current.productId).put("title", current.title)
                        .put("description", current.description).put("offers", offers))))
            }
        }
    }

    fun purchase(params: JSONObject) = ready {
        if (purchaseFlowInProgress) {
            emit(JSONObject().put("type", "billing-error").put("message", "Finish the current Google Play purchase first."))
            return@ready
        }
        val current = product
        val productId = params.optString("productId")
        val offerToken = params.optString("offerToken")
        val accountId = params.optString("accountId")
        if (productId != BuildConfig.PLAY_PRODUCT_ID || current == null ||
            !accountId.matches(Regex("^[a-f0-9]{64}$")) ||
            current.subscriptionOfferDetails.orEmpty().none { it.offerToken == offerToken }) {
            emit(JSONObject().put("type", "billing-error").put("message", "Sign in and refresh the Google Play offer before subscribing."))
            return@ready
        }
        val choice = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(current)
            .setOfferToken(offerToken).build()
        purchaseFlowInProgress = true
        val result = client.launchBillingFlow(activity, BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(choice)).setObfuscatedAccountId(accountId).build())
        if (result.responseCode != BillingClient.BillingResponseCode.OK) purchaseFlowInProgress = false
        if (result.responseCode == BillingClient.BillingResponseCode.OK)
            emit(JSONObject().put("type", "purchase-launched"))
        else if (result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) restore()
        else error(result)
    }

    fun restore() = ready {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()) { result, purchases ->
            activity.runOnUiThread {
                if (closed) return@runOnUiThread
                if (result.responseCode != BillingClient.BillingResponseCode.OK) { error(result); return@runOnUiThread }
                val relevant = purchases.filter { BuildConfig.PLAY_PRODUCT_ID in it.products }
                relevant.forEach { deliverPurchase(it, "restore") }
                emit(JSONObject().put("type", "restore-complete").put("count", relevant.size))
            }
        }
    }

    private fun deliverPurchase(purchase: Purchase, source: String) {
        if (closed || BuildConfig.PLAY_PRODUCT_ID !in purchase.products) return
        val state = when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> "PURCHASED"
            Purchase.PurchaseState.PENDING -> "PENDING"
            else -> return
        }
        emit(JSONObject().put("type", "purchase").put("source", source)
            .put("productId", BuildConfig.PLAY_PRODUCT_ID).put("purchaseToken", purchase.purchaseToken)
            .put("purchaseState", state).put("acknowledged", purchase.isAcknowledged))
    }

    private fun error(result: BillingResult) {
        // Do not log purchase tokens, account IDs, or provider debugMessage.
        val message = when (result.responseCode) {
            BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "Google Play billing is unavailable on this device."
            BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "The subscription is not available in this Google Play account or country."
            BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
            BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
            BillingClient.BillingResponseCode.NETWORK_ERROR -> "Cannot connect to Google Play. Please try again."
            else -> "Google Play could not complete this request. Please try again."
        }
        emit(JSONObject().put("type", "billing-error").put("code", result.responseCode).put("message", message))
    }

    fun cancelQueuedRequests() {
        // Pending connection actions must not launch a purchase for a page that
        // has navigated away. Require fresh product details in the next document.
        queued.clear()
        product = null
    }

    fun close() { closed = true; queued.clear(); client.endConnection() }
}
