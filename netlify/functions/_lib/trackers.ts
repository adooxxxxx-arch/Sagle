// Curated list of well-known tracker, advertising, analytics, session-replay
// and fingerprinting domains. Matching is by domain suffix, so subdomains
// (e.g. www.google-analytics.com) match their parent entry; the longest
// matching entry wins (connect.facebook.net beats facebook.net).
//
// Sources of inspiration: public lists such as Disconnect, DuckDuckGo Tracker
// Radar and EasyPrivacy. This list is intentionally conservative: CDNs and
// error-monitoring services (e.g. Sentry) are not listed.

import type { TrackerCategory } from '../../../shared/api.ts';

export interface TrackerInfo {
  domain: string;
  category: TrackerCategory;
  company: string;
}

type Group = [company: string, category: TrackerCategory, domains: string[]];

const GROUPS: Group[] = [
  // ---- Google
  ['Google', 'analytics', ['google-analytics.com', 'analytics.google.com', 'ssl.google-analytics.com']],
  ['Google', 'tag-manager', ['googletagmanager.com', 'tagmanager.google.com']],
  ['Google', 'advertising', [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com', 'adservice.google.com',
    'pagead2.googlesyndication.com', 'googleads.g.doubleclick.net', 'admob.com', 'adsense.com', '2mdn.net',
    'imasdk.googleapis.com', 'fundingchoicesmessages.google.com',
  ]],
  ['Google', 'analytics', ['app-measurement.com', 'firebase-settings.crashlytics.com']],
  // ---- Meta
  ['Meta', 'advertising', ['connect.facebook.net', 'facebook.net', 'atdmt.com']],
  ['Meta', 'social', ['facebook.com', 'fbcdn.net', 'instagram.com']],
  // ---- Microsoft
  ['Microsoft', 'session-replay', ['clarity.ms']],
  ['Microsoft', 'advertising', ['bat.bing.com', 'bat.r.msn.com', 'ads.microsoft.com', 'adnxs.com', 'adnxs-simple.com']],
  ['Microsoft', 'analytics', ['c.bing.com', 'c.msn.com', 'mktoresp.com']],
  ['LinkedIn', 'advertising', ['snap.licdn.com', 'px.ads.linkedin.com', 'ads.linkedin.com']],
  // ---- Amazon
  ['Amazon', 'advertising', ['amazon-adsystem.com', 'assoc-amazon.com', 'aax.amazon-adsystem.com']],
  // ---- X / Twitter
  ['X (Twitter)', 'advertising', ['ads-twitter.com', 'static.ads-twitter.com', 'analytics.twitter.com', 'ads-api.twitter.com', 't.co']],
  ['X (Twitter)', 'social', ['platform.twitter.com', 'syndication.twitter.com']],
  // ---- TikTok / ByteDance
  ['TikTok', 'advertising', ['analytics.tiktok.com', 'ads.tiktok.com', 'analytics-sg.tiktok.com', 'business-api.tiktok.com']],
  // ---- Other social
  ['Pinterest', 'advertising', ['ct.pinterest.com', 'trk.pinterest.com', 'analytics.pinterest.com']],
  ['Pinterest', 'social', ['assets.pinterest.com', 'widgets.pinterest.com']],
  ['Snap', 'advertising', ['sc-static.net', 'tr.snapchat.com']],
  ['Reddit', 'advertising', ['redditstatic.com', 'alb.reddit.com', 'events.redditmedia.com']],
  ['AddThis (Oracle)', 'social', ['addthis.com', 'addthisedge.com']],
  ['ShareThis', 'social', ['sharethis.com', 'sharethis.net']],
  ['AddToAny', 'social', ['static.addtoany.com']],
  ['Disqus', 'social', ['disqus.com', 'disquscdn.com', 'disqusads.com']],
  // ---- Product analytics
  ['Segment', 'analytics', ['segment.io', 'segment.com', 'cdn.segment.com', 'api.segment.io']],
  ['Mixpanel', 'analytics', ['mixpanel.com', 'mxpnl.com', 'mxpnl.net']],
  ['Amplitude', 'analytics', ['amplitude.com', 'cdn.amplitude.com', 'api.amplitude.com', 'api2.amplitude.com']],
  ['Heap', 'analytics', ['heap.io', 'heapanalytics.com']],
  ['PostHog', 'analytics', ['posthog.com', 'i.posthog.com']],
  ['Pendo', 'analytics', ['pendo.io']],
  ['Kissmetrics', 'analytics', ['kissmetrics.io', 'kissmetrics.com']],
  ['Adobe', 'analytics', ['omtrdc.net', '2o7.net', 'demdex.net', 'everesttech.net', 'adobedtm.com', 'omniture.com', 'sc.omtrdc.net']],
  ['Adobe', 'tag-manager', ['assets.adobedtm.com']],
  ['Oracle', 'analytics', ['bluekai.com', 'addthiscdn.com', 'moatads.com', 'moatpixel.com', 'grapeshot.co.uk', 'eloqua.com', 'en25.com']],
  ['Chartbeat', 'analytics', ['chartbeat.com', 'chartbeat.net']],
  ['Parse.ly', 'analytics', ['parsely.com', 'parse.ly', 'cdn.parsely.com']],
  ['comScore', 'analytics', ['scorecardresearch.com', 'comscore.com', 'sb.scorecardresearch.com']],
  ['Quantcast', 'analytics', ['quantserve.com', 'quantcount.com', 'quantcast.com']],
  ['Nielsen', 'analytics', ['imrworldwide.com', 'nielsen.com', 'exelator.com']],
  ['New Relic', 'analytics', ['nr-data.net', 'newrelic.com', 'js-agent.newrelic.com', 'bam.nr-data.net']],
  ['Datadog', 'analytics', ['browser-intake-datadoghq.com', 'browser-intake-datadoghq.eu', 'rum.browser-intake-datadoghq.com']],
  ['Dynatrace', 'analytics', ['dynatrace.com', 'ruxit.com']],
  ['Optimizely', 'analytics', ['optimizely.com', 'cdn.optimizely.com', 'logx.optimizely.com']],
  ['VWO', 'analytics', ['visualwebsiteoptimizer.com', 'vwo.com']],
  ['AB Tasty', 'analytics', ['abtasty.com']],
  ['Kameleoon', 'analytics', ['kameleoon.com', 'kameleoon.eu']],
  ['Matomo Cloud', 'analytics', ['matomo.cloud', 'innocraft.cloud']],
  ['Yandex', 'analytics', ['mc.yandex.ru', 'metrika.yandex.ru', 'yandex.ru/metrika', 'an.yandex.ru']],
  ['Baidu', 'analytics', ['hm.baidu.com', 'pos.baidu.com']],
  ['Alexa', 'analytics', ['alexametrics.com']],
  ['StatCounter', 'analytics', ['statcounter.com']],
  ['Clicky', 'analytics', ['static.getclicky.com', 'getclicky.com']],
  ['Woopra', 'analytics', ['woopra.com']],
  ['Snowplow', 'analytics', ['snplow.net']],
  ['Tealium', 'tag-manager', ['tiqcdn.com', 'tealiumiq.com', 'tealium.com']],
  ['Ensighten', 'tag-manager', ['ensighten.com', 'nexus.ensighten.com']],
  ['Piwik PRO', 'tag-manager', ['piwik.pro', 'containers.piwik.pro']],
  ['Wix', 'analytics', ['frog.wix.com']],
  ['WordPress.com', 'analytics', ['stats.wp.com', 'pixel.wp.com']],
  ['Cloudflare', 'analytics', ['cloudflareinsights.com', 'static.cloudflareinsights.com']],
  // ---- Session replay / heatmaps
  ['Hotjar', 'session-replay', ['hotjar.com', 'hotjar.io', 'static.hotjar.com']],
  ['FullStory', 'session-replay', ['fullstory.com', 'rs.fullstory.com', 'edge.fullstory.com']],
  ['Mouseflow', 'session-replay', ['mouseflow.com']],
  ['Crazy Egg', 'session-replay', ['crazyegg.com', 'script.crazyegg.com']],
  ['Lucky Orange', 'session-replay', ['luckyorange.com', 'luckyorange.net']],
  ['Smartlook', 'session-replay', ['smartlook.com', 'smartlook.cloud']],
  ['LogRocket', 'session-replay', ['logrocket.com', 'logrocket.io', 'lr-ingest.io', 'lr-in-prod.com']],
  ['Inspectlet', 'session-replay', ['inspectlet.com']],
  ['Quantum Metric', 'session-replay', ['quantummetric.com']],
  ['ContentSquare', 'session-replay', ['contentsquare.net', 'contentsquare.com', 'clicktale.net']],
  ['Glassbox', 'session-replay', ['glassboxdigital.io', 'glassboxcdn.com']],
  ['Decibel', 'session-replay', ['decibelinsight.net']],
  ['SessionCam', 'session-replay', ['sessioncam.com']],
  ['Yandex', 'session-replay', ['webvisor.com']],
  // ---- Fingerprinting / bot-detection used for identification
  ['FingerprintJS', 'fingerprinting', ['fpjs.io', 'fpcdn.io', 'fingerprintjs.com', 'fingerprint.com', 'api.fpjs.io']],
  ['ThreatMetrix', 'fingerprinting', ['online-metrix.net', 'threatmetrix.com']],
  ['Iovation', 'fingerprinting', ['iesnare.com', 'iovation.com']],
  ['Sift', 'fingerprinting', ['sift.com', 'siftscience.com']],
  ['ID5', 'fingerprinting', ['id5-sync.com']],
  ['LiveRamp', 'fingerprinting', ['rlcdn.com', 'liveramp.com', 'ats.rlcdn.com', 'pippio.com']],
  ['The Trade Desk', 'fingerprinting', ['adsrvr.org', 'uidapi.com']],
  ['Tapad', 'fingerprinting', ['tapad.com']],
  ['Zeotap', 'fingerprinting', ['zeotap.com']],
  ['33Across', 'fingerprinting', ['33across.com']],
  // ---- Ad exchanges, SSPs, DSPs, retargeting
  ['Criteo', 'advertising', ['criteo.com', 'criteo.net', 'emailretargeting.com']],
  ['Taboola', 'advertising', ['taboola.com', 'taboolasyndication.com', 'trc.taboola.com']],
  ['Outbrain', 'advertising', ['outbrain.com', 'outbrainimg.com', 'widgets.outbrain.com']],
  ['Magnite', 'advertising', ['rubiconproject.com', 'fastlane.rubiconproject.com', 'magnite.com', 'telaria.com']],
  ['PubMatic', 'advertising', ['pubmatic.com', 'ads.pubmatic.com']],
  ['OpenX', 'advertising', ['openx.net', 'openx.com', 'servedbyopenx.com']],
  ['Index Exchange', 'advertising', ['casalemedia.com', 'indexww.com']],
  ['Xandr', 'advertising', ['adnxs.net']],
  ['Yahoo', 'advertising', ['advertising.com', 'adtechus.com', 'yahoodns.net', 'analytics.yahoo.com', 'ads.yahoo.com', 'yimg.com/wi', 'gemini.yahoo.com']],
  ['Verizon Media', 'advertising', ['adap.tv', 'aol.com/ads', 'btrll.com']],
  ['Sovrn', 'advertising', ['lijit.com', 'sovrn.com']],
  ['TripleLift', 'advertising', ['3lift.com', 'triplelift.com']],
  ['Sharethrough', 'advertising', ['sharethrough.com']],
  ['GumGum', 'advertising', ['gumgum.com']],
  ['Smart AdServer', 'advertising', ['smartadserver.com', 'sascdn.com']],
  ['Teads', 'advertising', ['teads.tv', 'teads.com']],
  ['Media.net', 'advertising', ['media.net', 'contextual.media.net']],
  ['Sizmek', 'advertising', ['serving-sys.com', 'sizmek.com']],
  ['MediaMath', 'advertising', ['mathtag.com']],
  ['AdRoll', 'advertising', ['adroll.com']],
  ['Quantcast Choice', 'advertising', ['quantcast.mgr.consensu.org']],
  ['Lotame', 'advertising', ['crwdcntrl.net', 'lotame.com']],
  ['Neustar', 'advertising', ['agkn.com']],
  ['Bidswitch', 'advertising', ['bidswitch.net']],
  ['Adform', 'advertising', ['adform.net', 'adformdsp.net']],
  ['Yieldmo', 'advertising', ['yieldmo.com']],
  ['Undertone', 'advertising', ['undertone.com']],
  ['Conversant', 'advertising', ['dotomi.com', 'conversantmedia.com', 'fastclick.net']],
  ['Integral Ad Science', 'advertising', ['adsafeprotected.com', 'iasds01.com']],
  ['DoubleVerify', 'advertising', ['doubleverify.com', 'dvtps.com']],
  ['Revcontent', 'advertising', ['revcontent.com']],
  ['MGID', 'advertising', ['mgid.com']],
  ['Zemanta', 'advertising', ['zemanta.com']],
  ['Skimlinks', 'advertising', ['skimresources.com', 'skimlinks.com']],
  ['VigLink', 'advertising', ['viglink.com']],
  ['Bounce Exchange', 'advertising', ['bounceexchange.com', 'bouncex.net']],
  ['Spotxchange', 'advertising', ['spotxchange.com', 'spotx.tv']],
  ['Kargo', 'advertising', ['kargo.com']],
  ['Connatix', 'advertising', ['connatix.com']],
  ['Primis', 'advertising', ['primis.tech']],
  ['Ezoic', 'advertising', ['ezoic.net', 'ezojs.com']],
  ['Mediavine', 'advertising', ['mediavine.com']],
  ['AdThrive', 'advertising', ['adthrive.com']],
  ['Prebid', 'advertising', ['prebid.org']],
  ['Moloco', 'advertising', ['moloco.com']],
  ['Unity Ads', 'advertising', ['unityads.unity3d.com']],
  ['AppLovin', 'advertising', ['applovin.com', 'applvn.com']],
  ['ironSource', 'advertising', ['supersonicads.com', 'ironsrc.com']],
  ['InMobi', 'advertising', ['inmobi.com']],
  ['StackAdapt', 'advertising', ['stackadapt.com']],
  ['Quora', 'advertising', ['q.quora.com']],
  ['Impact', 'advertising', ['impactradius-event.com', 'impact.com']],
  ['Awin', 'advertising', ['awin1.com', 'zenaps.com']],
  ['CJ Affiliate', 'advertising', ['emjcd.com', 'anrdoezrs.net', 'dpbolvw.net', 'jdoqocy.com', 'kqzyfj.com', 'tkqlhce.com']],
  ['Rakuten Advertising', 'advertising', ['linksynergy.com']],
  ['ShareASale', 'advertising', ['shareasale.com', 'shareasale-analytics.com']],
  // ---- Mobile attribution / deep linking
  ['Branch', 'analytics', ['branch.io', 'app.link', 'bnc.lt']],
  ['AppsFlyer', 'analytics', ['appsflyer.com', 'onelink.me', 'appsflyersdk.com']],
  ['Adjust', 'analytics', ['adjust.com', 'adj.st', 'adjust.io']],
  ['Kochava', 'analytics', ['kochava.com']],
  ['Singular', 'analytics', ['singular.net', 'sng.link']],
  // ---- Marketing automation / CRM tracking
  ['HubSpot', 'analytics', ['hs-analytics.net', 'hs-scripts.com', 'hscollectedforms.net', 'hsadspixel.net', 'hubspot.com', 'hsforms.net', 'usemessages.com']],
  ['Marketo', 'analytics', ['marketo.net', 'marketo.com', 'mktoweb.com']],
  ['Salesforce', 'analytics', ['pardot.com', 'krxd.net', 'exacttarget.com', 'evergage.com', 'igodigital.com']],
  ['Klaviyo', 'analytics', ['klaviyo.com', 'static.klaviyo.com']],
  ['Mailchimp', 'analytics', ['chimpstatic.com', 'list-manage.com']],
  ['Intercom', 'analytics', ['intercom.io', 'intercomcdn.com', 'widget.intercom.io']],
  ['Drift', 'analytics', ['drift.com', 'driftt.com']],
  ['Zendesk', 'analytics', ['zdassets.com']],
  ['ZoomInfo', 'analytics', ['zoominfo.com', 'ws.zoominfo.com']],
  ['Clearbit', 'analytics', ['clearbit.com', 'clearbitscripts.com']],
  ['6sense', 'analytics', ['6sc.co', '6sense.com']],
  ['Demandbase', 'analytics', ['demandbase.com']],
  ['Leadfeeder', 'analytics', ['leadfeeder.com', 'lfeeder.com']],
  ['Bombora', 'analytics', ['ml314.com']],
  ['Braze', 'analytics', ['braze.com', 'appboycdn.com']],
  ['OneSignal', 'analytics', ['onesignal.com']],
  ['Iterable', 'analytics', ['iterable.com']],
  ['Customer.io', 'analytics', ['customer.io', 'track.customer.io']],
  ['Pushwoosh', 'analytics', ['pushwoosh.com']],
  // ---- Consent platforms that also profile
  ['OneTrust', 'other', ['onetrust.com', 'cookielaw.org', 'cookiepro.com']],
  ['TrustArc', 'other', ['trustarc.com', 'truste.com']],
  ['Cookiebot', 'other', ['cookiebot.com', 'consentcdn.net']],
  ['Didomi', 'other', ['privacy-center.org', 'didomi.io']],
  ['Sourcepoint', 'other', ['sp-prod.net', 'sourcepoint.com']],
  // ---- Video / misc embeds that track
  ['Vimeo', 'analytics', ['vimeocdn.com/js_opt/logging']],
  ['JW Player', 'analytics', ['jwpltx.com']],
  ['Brightcove', 'analytics', ['metrics.brightcove.com']],
  ['Gravatar', 'other', ['gravatar.com']],
  ['Polar', 'advertising', ['mediavoice.com']],
  ['Piano', 'analytics', ['tinypass.com', 'piano.io', 'cxense.com']],
  ['Permutive', 'analytics', ['permutive.com', 'permutive.app']],
  ['Blueconic', 'analytics', ['blueconic.net']],
  ['Medallia', 'analytics', ['kampyle.com', 'medallia.com']],
  ['Qualtrics', 'analytics', ['qualtrics.com', 'siteintercept.qualtrics.com']],
  ['Usabilla', 'analytics', ['usabilla.com']],
  ['ForeSee', 'analytics', ['foresee.com']],
  ['Trustpilot', 'other', ['widget.trustpilot.com']],
  ['Yotpo', 'analytics', ['yotpo.com']],
  ['Bazaarvoice', 'analytics', ['bazaarvoice.com']],
  ['Hitwise', 'analytics', ['hitwise.com']],
  ['Similarweb', 'analytics', ['similarweb.com']],
];

const TRACKERS = new Map<string, TrackerInfo>();
for (const [company, category, domains] of GROUPS) {
  for (const d of domains) {
    // Path-qualified entries (e.g. "yandex.ru/metrika") cannot be matched on host alone; skip them.
    if (d.includes('/')) continue;
    if (!TRACKERS.has(d)) TRACKERS.set(d, { domain: d, category, company });
  }
}
// Collapse subdomain entries into a listed parent with the same company and
// category (static.hotjar.com → hotjar.com) so reports aggregate per tracker.
for (const [d, info] of [...TRACKERS]) {
  for (let p = d.slice(d.indexOf('.') + 1); p.includes('.'); p = p.slice(p.indexOf('.') + 1)) {
    const parent = TRACKERS.get(p);
    if (parent && parent.company === info.company && parent.category === info.category) {
      TRACKERS.delete(d);
      break;
    }
  }
}

export const TRACKER_COUNT = TRACKERS.size;

/** Finds the most specific tracker entry matching `host` (or any parent domain). */
export function matchTracker(host: string): TrackerInfo | null {
  let h = host.toLowerCase();
  while (h.endsWith('.')) h = h.slice(0, -1);
  // Walk from the full host towards the TLD: the first hit is the longest match.
  for (;;) {
    const hit = TRACKERS.get(h);
    if (hit) return hit;
    const dot = h.indexOf('.');
    if (dot === -1) return null;
    h = h.slice(dot + 1);
  }
}
