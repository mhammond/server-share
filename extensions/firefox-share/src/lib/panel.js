/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Raindrop.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *	Anant Narayanan <anant@kix.in>
 *	Shane Caraveo <shanec@mozillamessaging.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {Cc, Ci, Cm, Cu, components} = require("chrome");

let tmp = {};
Cu.import("resource://gre/modules/Services.jsm", tmp);
Cu.import("resource://gre/modules/PlacesUtils.jsm", tmp);
Cu.import("resource://gre/modules/XPCOMUtils.jsm", tmp);
let {Services, PlacesUtils, XPCOMUtils} = tmp;

let {StateProgressListener} = require("progress");

// the open web apps service helpers.
let {serviceInvocationHandler} = require("services");

const FFSHARE_EXT_ID = "ffshare@mozilla.org";
const SHARE_STATUS = ["", "start", "", "finished"];
const SHARE_DONE = 0;
const SHARE_START = 1;
const SHARE_ERROR = 2;
const SHARE_FINISHED = 3;

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

function mixin(target, source, override) {
  //TODO: consider ES5 getters and setters in here.
  for (let prop in source) {
    if (!(prop in {}) && (!(prop in target) || override)) {
      target[prop] = source[prop];
    }
  }
}

function unescapeXml(text) {
  return text.replace(/&lt;|&#60;/g, '<')
         .replace(/&gt;|&#62;/g, '>')
         .replace(/&amp;|&#38;/g, '&')
         .replace(/&apos;|&#39;/g, '\'')
         .replace(/&quot;|&#34;/g, '"');
}

function pageOptionsBuilder(browser)
{
  this.gBrowser = browser;
}

pageOptionsBuilder.prototype = {
  getPageTitle: function () {
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:title']"),
        i, title, content;
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        //Title could have some XML escapes in it since it could be an
        //og:title type of tag, so be sure unescape
        return unescapeXml(content.trim());
      }
    }

    metas = this.gBrowser.contentDocument.querySelectorAll("meta[name='title']");
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        // Title could have some XML escapes in it so be sure unescape
        return unescapeXml(content.trim());
      }
    }

    title = this.gBrowser.contentDocument.getElementsByTagName("title")[0];
    if (title && title.firstChild) {
      // Use node Value because we have nothing else
      return title.firstChild.nodeValue.trim();
    }
    return "";
  },

  getPageDescription: function () {
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:description']"),
        i, content;
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        return unescapeXml(content);
      }
    }

    metas = this.gBrowser.contentDocument.querySelectorAll("meta[name='description']");
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        return unescapeXml(content);
      }
    }
    return "";
  },

  getSiteName: function () {
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:site_name']");
    for (let i = 0; i < metas.length; i++) {
      let content = metas[i].getAttribute("content");
      if (content) {
        return unescapeXml(content);
      }
    }
    return "";
  },

  // According to Facebook - (only the first 3 are interesting)
  // Valid values for medium_type are audio, image, video, news, blog, and mult.
  getPageMedium: function () {
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:type']"),
        i, content;
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        return unescapeXml(content);
      }
    }

    metas = this.gBrowser.contentDocument.querySelectorAll("meta[name='medium']");
    for (i = 0; i < metas.length; i++) {
      content = metas[i].getAttribute("content");
      if (content) {
        return unescapeXml(content);
      }
    }
    return "";
  },

  getSourceURL: function () {
    // Ideally each page would report the medium correctly, but some
    // do not, like vimeo, so always just look for a video source.
    let source = this.getVideoSourceURL();
    return source || "";
  },

  getVideoSourceURL: function () {
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:video']");
    for (let i = 0; i < metas.length; i++) {
      let content = metas[i].getAttribute("content");
      if (content && (content = this._validURL(unescapeXml(content)))) {
        return content;
      }
    }
    return this.getVideoSourceURLHacks();
  },

  getVideoSourceURLHacks: function () {
    let canonical = this.getCanonicalURL(),
        host = this.gBrowser.currentURI.host,
        params, embeds, i, src, flashvars, value, url;

    // YouTube hack to get the right source without too many parameters
    if (host.indexOf("youtube.com") >= 0 &&
        canonical.match(/v=([A-Za-z0-9._%\-]*)[&\w;=\+_\-]*/)) {
      let id = canonical.match(/v=([A-Za-z0-9._%\-]*)[&\w;=\+_\-]*/)[1];
      return "http:// www.youtube.com/v/" + id;
    }

    // Vimeo hack to find the <object data="src"><param name="flashvars"/></object> pieces we need
    embeds = this.gBrowser.contentDocument.querySelectorAll("object[type='application/x-shockwave-flash'][data]");
    params = this.gBrowser.contentDocument.querySelectorAll("param[name='flashvars']");
    if (params && params.length) {
      for (i = 0; i < embeds.length; i++) {
        src = embeds[i].getAttribute("data");
        flashvars = params[0].getAttribute("value");
        if (flashvars) {
          src += (src.indexOf("?") < 0 ? "?" : "&amp;") + decodeURIComponent(flashvars);
        }
        if ((url = this._validURL(unescapeXml(src)))) {
          return url;
        }
      }
    }

    // A generic hack that looks for the <param name="movie"> which is often available
    // for backwards compat and IE
    params = this.gBrowser.contentDocument.querySelectorAll("param[name='movie']");
    for (i = 0; i < params.length; i++) {
      value = params[i].getAttribute("value");
      if (value) {
        if ((url = this._validURL(unescapeXml(value)))) {
          return url;
        }
      }
    }

    // This one is fairly bad because the flashvars can exceed a reasonable
    // url length limit and since it is only sent to flash it is often large
    embeds = this.gBrowser.contentDocument.querySelectorAll("embed[src]");
    for (i = 0; i < embeds.length; i++) {
      src = embeds[i].getAttribute("src");
      flashvars = embeds[i].getAttribute("flashvars");
      if (flashvars) {
        src += (src.indexOf("?") < 0 ? "?" : "&amp;") + decodeURIComponent(flashvars);
      }
      if ((url = this._validURL(unescapeXml(src)))) {
        return url;
      }
    }
    return "";
  },

  getShortURL: function () {
    let shorturl = this.gBrowser.contentDocument.getElementById("shorturl"),
        links = this.gBrowser.contentDocument.querySelectorAll("link[rel='shortlink']");

    // flickr does id="shorturl"
    if (shorturl && (shorturl = this._validURL(shorturl.getAttribute("href")))) {
      return shorturl;
    }

    for (let i = 0; i < links.length; i++) {
      let content = this._validURL(links[i].getAttribute("href"));
      if (content) {
        return content;
      }
    }
    return "";
  },

  getCanonicalURL: function () {
    let links = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:url']"),
        i, content;

    for (i = 0; i < links.length; i++) {
      if ((content = this._validURL(links[i].getAttribute("content")))) {
        return content;
      }
    }

    links = this.gBrowser.contentDocument.querySelectorAll("link[rel='canonical']");

    for (i = 0; i < links.length; i++) {
      if ((content = this._validURL(links[i].getAttribute("href")))) {
        return content;
      }
    }

    // Finally try some hacks for certain sites
    return this.getCanonicalURLHacks();
  },

  // This will likely be a collection of hacks for certain sites we want to
  // work but currently don't provide the right kind of meta data
  getCanonicalURLHacks: function () {
    // Google Maps Hack :( obviously this regex isn't robust
    if (/^maps\.google\.[a-zA-Z]{2,5}/.test(this.gBrowser.currentURI.host)) {
      return this._validURL(this.gBrowser.contentDocument.getElementById("link").getAttribute("href"));
    }

    return '';
  },

  getThumbnailData: function () {
    let canvas = this.gBrowser.contentDocument.createElement("canvas"); // where?
    canvas.setAttribute('width', '90');
    canvas.setAttribute('height', '70');
    let tab = this.gBrowser.selectedTab;
    let win = this.gBrowser.getBrowserForTab(tab).contentWindow;
    let aspectRatio = canvas.width / canvas.height;
    let w = win.innerWidth + win.scrollMaxX;
    let h = Math.max(win.innerHeight, w / aspectRatio);

    if (w > 10000) {
      w = 10000;
    }
    if (h > 10000) {
      h = 10000;
    }

    let canvasW = canvas.width;
    let canvasH = canvas.height;
    let ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();

    let scale = canvasH / h;
    ctx.scale(scale, scale);
    ctx.drawWindow(win, 0, 0, w, h, "rgb(255,255,255)");
    ctx.restore();
    let img = canvas.toDataURL("image/png", "");
    return img;
  },

  _validURL: function(url) {
    // hacky validation of a url to make sure it at least appears valid
    url = this.gBrowser.currentURI.resolve(url);
    if (!/\w+:\/\/[^\/]+\/.+/.test(url))
      return null;
    return url;
  },

  previews: function () {
    // Look for FB og:image and then rel="image_src" to use if available
    // for og:image see: http://developers.facebook.com/docs/share
    // for image_src see: http://about.digg.com/thumbnails
    let metas = this.gBrowser.contentDocument.querySelectorAll("meta[property='og:image']"),
        links = this.gBrowser.contentDocument.querySelectorAll("link[rel='image_src']"),
        previews = [], i, content;

    for (i = 0; i < metas.length; i++) {
      content = this._validURL(metas[i].getAttribute("content"));
      if (content) {
        previews.push({
          http_url : content,
          base64 : ""
        });
      }
    }

    for (i = 0; i < links.length; i++) {
      content = this._validURL(links[i].getAttribute("href"));
      if (content) {
        previews.push({
          http_url : content,
          base64 : ""
        });
      }
    }

    // Push in the page thumbnail last in case there aren't others
    previews.push(
      {
        http_url : "",
        base64 : this.getThumbnailData()
      }
    );
    return previews;
  }
};


// singleton controller for the share panel
// A state object is attached to each browser tab when the share panel
// is opened for that tab.  The state object is removed from the current
// tab when the panel is closed.
function sharePanelHelper(window, ffshare) {
  this.window = window;

  this.gBrowser = window.gBrowser;
  this.document = window.document;
  this.ffshare = ffshare;

  this.button = this.document.getElementById('share-button');
//  this.browser = this.document.getElementById('share-browser');
//  this.panel = this.document.getElementById('share-popup');
  this.services = new serviceInvocationHandler(this.window);

  this.defaultWidth = 400;
  this.lastWidth = 400;
  this.defaultHeight = 180;
  this.lastHeight = 180;
  this.forceReload = true;

  this.init();
}
sharePanelHelper.prototype = {
  init: function () {
    // observer for when apps are installed.
    let observerService = Cc["@mozilla.org/observer-service;1"]
                            .getService(Ci.nsIObserverService);
    observerService.addObserver(this, "openwebapp-installed", false);
    observerService.addObserver(this, "openwebapp-uninstalled", false);
    // Extend Services object
    XPCOMUtils.defineLazyServiceGetter(
      Services, "bookmarks",
      "@mozilla.org/browser/nav-bookmarks-service;1",
      "nsINavBookmarksService"
    );
  },

  unload: function () {
    let webProgress = this.browser.webProgress;
    webProgress.removeProgressListener(this.stateProgressListener);
    this.stateProgressListener = null;
  },

  observe: function(subject, topic, data) {
    if (topic === 'openwebapp-installed' || topic === 'openwebapp-uninstalled') {
      let win = this.browser.contentWindow.wrappedJSObject;
      win.postMessage(JSON.stringify({
        topic: topic,
        data: JSON.parse(data)
      }), win.location.protocol + "//" + win.location.host);
    }
  },

  onMediatorCallback: function(message) {
    // listen for messages now
    let contentWindow = this.browser.contentWindow;
    contentWindow = contentWindow.wrappedJSObject ? contentWindow.wrappedJSObject : contentWindow;
    cmd = message.cmd;
    if (cmd && this[cmd]) {
      try {
        return this[cmd](message);
      } catch (ex) {
        console.error("Handler of topic", topic, "failed:", ex);
      }
    } else {
      console.log("ignoring mediator callback", cmd);
    }
    // not handled so just return the same message
    return message;
  },

  // Fired when a pref changes from content space. the pref object has
  // a name and value.
  prefChanged: function (pref) {
    let Application = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);
    Application.prefs.setValue("extensions." + FFSHARE_EXT_ID + "." + pref.name, pref.value);
  },

  getOptions: function (options) {
    var pageOpts = new pageOptionsBuilder(this.gBrowser);
    options = options || {};
    mixin(options, {
      version: this.ffshare.version,
      title: pageOpts.getPageTitle(),
      description: pageOpts.getPageDescription(),
      medium: pageOpts.getPageMedium(),
      source: pageOpts.getSourceURL(),
      url: this.gBrowser.currentURI.spec,
      canonicalUrl: pageOpts.getCanonicalURL(),
      shortUrl: pageOpts.getShortURL(),
      previews: pageOpts.previews(),
      siteName: pageOpts.getSiteName(),
      prefs: {
        system: this.ffshare.prefs.system,
        bookmarking: this.ffshare.prefs.bookmarking,
        use_accel_key: this.ffshare.prefs.use_accel_key
      }
    });
    return options;
  },

  /**
   * PostMessage APIs
   * Called by content page when share is successful.
   * @param {Object} data info about the share.
   */
  success: function (data) {
    this.updateStatus([SHARE_DONE,,,data.url], true);
    this.close();

    // XXX we should work out a better bookmarking system
    // https:// github.com/mozilla/f1/issues/66
    if (this.ffshare.prefs.bookmarking) {
      let tags = ['shared', 'f1', data.service];

      let nsiuri = Services.io.newURI(data.url, null, null);
      if (!Services.bookmarks.isBookmarked(nsiuri)) {
          Services.bookmarks.insertBookmark(
              Services.bookmarks.unfiledBookmarksFolder, nsiuri,
              Services.bookmarks.DEFAULT_INDEX, this.getPageTitle().trim()
          );
      }
      PlacesUtils.tagging.tagURI(nsiuri, tags);
    }
  },

  /**
   * Method used to generate thumbnail data from a postMessage
   * originating from the share UI in content-space
   */
  generateBase64Preview: function (imgUrl) {
    let self = this;
    let img = new this.window.Image();
    img.onload = function () {

      let canvas = self.document.createElementNS(NS_XUL, "canvas"),
          win = self.browser.contentWindow.wrappedJSObject,
          w = img.width,
          h = img.height,
          dataUrl, canvasW, canvasH, ctx, scale;

      // Put upper constraints on the image size.
      if (w > 10000) {
        w = 10000;
      }
      if (h > 10000) {
        h = 10000;
      }

      canvas.setAttribute('width', '90');
      canvas.setAttribute('height', '70');

      canvasW = canvas.width;
      canvasH = canvas.height;
      ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.save();

      scale = canvasH / h;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      dataUrl = canvas.toDataURL("image/png", "");

      win.postMessage(JSON.stringify({
        topic: 'base64Preview',
        data: dataUrl
      }), win.location.protocol + "//" + win.location.host);

    };
    img.src = imgUrl;
  },

  getShareState: function() {
    let win = this.browser.contentWindow.wrappedJSObject;
    win.postMessage(JSON.stringify({
        topic: 'shareState',
        data: this.gBrowser.selectedTab.shareState
      }), win.location.protocol + "//" + win.location.host);
  },

  sizeToContent: function () {
    let doc = this.browser.contentDocument.wrappedJSObject;
    let wrapper = doc && doc.getElementById('wrapper');
    if (!wrapper) {
      return;
    }
    // XXX - the sizeToContent logic doesn't work correctly when error divs etc
    // are shown - as they aren't in 'wrapper' their size isn't taken into
    // account.
    // But doing it this way means the panel is slightly larger than it should
    // be when only the wrapper is actually showing :(
    let wrapper = this.browser.contentWindow;
    // XXX argh, we really should look at the panel and see what margins/padding
    // sizes are and calculate that way, however this is pretty complex due
    // to how the background image of the panel is used,
    // dump("content size is "+wrapper.scrollWidth+" x "+wrapper.scrollHeight+"\n");
    let h = this.lastWidth > this.defaultHeight ? this.lastWidth : this.defaultHeight;
    this.lastWidth = wrapper.scrollWidth;
    this.lastHeight = wrapper.scrollHeight > 0 ? wrapper.scrollHeight : h;
    this.browser.style.width = this.lastWidth + "px";
    this.browser.style.height = this.lastHeight + "px";
  },


  /**
   * Called when we want to hide the panel and possibly destroy the shareState information
   */
  close: function () {
    this.panel.hidePopup();
    if (this.gBrowser.selectedTab.shareState) {
      if (this.gBrowser.selectedTab.shareState.status === 0) {
        this.gBrowser.selectedTab.shareState = null;
      } else {
        this.gBrowser.selectedTab.shareState.open = false;
      }
    }

    // Always ensure the button is unchecked when the panel is hidden
    if (this.button) this.button.removeAttribute("checked");
  },

  _getBrowserTabForUrl: function(url) {
    if (!url)
      return this.gBrowser.selectedTab;
    if (this.gBrowser.getBrowserForTab(this.gBrowser.selectedTab).currentURI.spec == url)
      return this.gBrowser.selectedTab;
    var numTabs = this.gBrowser.browsers.length;
    for (var index = 0; index < numTabs; index++) {
      var currentBrowser = this.gBrowser.getBrowserAtIndex(index);
      if (url == currentBrowser.currentURI.spec) {
        return this.gBrowser.tabs[index];
      }
    }
    return this.gBrowser.selectedTab;
  },

  /**
   * Updates the state of the toolbar button during a share activity or
   * afterward when a share error is received.
   * @param {Integer} an index value that has meaning in the SHARE_STATUS array
   * @param {Boolean} only passed by the final success call
   */
  updateStatus: function (statusData, success) {
    let contentTab = this._getBrowserTabForUrl(statusData && statusData.length > 3 ? statusData[3] : null),
        nBox = this.gBrowser.getNotificationBox(this.gBrowser.getBrowserForTab(contentTab)),
        notification = nBox.getNotificationWithValue("mozilla-f1-share-error"),
        button = this.button,
        self = this,
        status,
        buttons;

    if (typeof(statusData) === 'undefined') {
      statusData = contentTab.shareState ? contentTab.shareState.status : [SHARE_DONE];
    }
    status = statusData[0];

    if (status === SHARE_ERROR) {
      // Check that we aren't already displaying our notification
      if (!notification) {
        buttons = [{
          label: "try again",
          accessKey: null,
          callback: function () {
            let nb = self.gBrowser.getNotificationBox();
            nb.removeNotification(nb.getNotificationWithValue("mozilla-f1-share-error"));
            self.window.setTimeout(function () {
              self.ffshare.togglePanel();
            }, 0);
          }
        }];
        nBox.appendNotification("There was a problem sharing this page.",
                                "mozilla-f1-share-error",
                                null,
                                nBox.PRIORITY_WARNING_MEDIUM, buttons);
      }
    } else if (status === SHARE_DONE && notification) {
      nBox.removeNotification(notification);
    }

    if (contentTab.shareState) {
      contentTab.shareState.status = statusData;
    }

    if (button && this.gBrowser.selectedTab == contentTab) {
      // Only a final successful share should be passing this value
      if (success) {
        button.setAttribute("status", SHARE_STATUS[SHARE_FINISHED]);
        this.window.setTimeout(function () {
          button.setAttribute("status", SHARE_STATUS[status]);
        }, 2900);
      } else {
        button.setAttribute("status", SHARE_STATUS[status]);
      }
    }
  },

  /**
   * Called when we only want to hide the panel and preserve the shareState
   * information
   */
  hide: function () {
    this.panel.hidePopup();
    this.gBrowser.selectedTab.shareState.open = false;
    if (this.button) this.button.removeAttribute("checked");
  },

  show: function (options) {
    let contentBrowser = this.gBrowser.getBrowserForTab(this.gBrowser.selectedTab),
        tabURI = contentBrowser.currentURI,
        tabUrl = tabURI.spec,
        nBox = this.gBrowser.getNotificationBox(contentBrowser),
        notification = nBox.getNotificationWithValue("mozilla-f1-share-error");

    if (!this.ffshare.isValidURI(tabURI)) {
      return;
    }

    if (notification) {
      nBox.removeNotification(notification);
    }
    let currentState = this.gBrowser.selectedTab.shareState;
    options = this.getOptions(options);

    this.gBrowser.selectedTab.shareState = {
      options: options,
      // currently not used for anything
      status: currentState ? currentState.status : 0,
      open: true
    };

    let url = this.ffshare.prefs.share_url + '#options=' + encodeURIComponent(JSON.stringify(options));

    // adjust the size
    this.browser.style.width = this.lastWidth + 'px';
    this.browser.style.height = this.lastHeight + 'px';

    // Make sure it can go all the way to zero.
    this.browser.style.minHeight = 0;

    if (this.forceReload) {
      this.browser.loadURI(url);
      this.forceReload = false;
    } else {
      this.browser.setAttribute('src', url);
    }

    let anchor;
    if (this.button) {
      // Always ensure the button is checked if the panel is open
      this.button.setAttribute("checked", true);
      // Always ensure we aren't glowing if the person clicks on the button
      this.button.removeAttribute("firstRun");
      anchor = this.button;
    } else {
      // use urlbar as the anchor
      anchor = document.getElementById('identity-box');
    }

    // fx 4
    let position = (this.window.getComputedStyle(this.window.gNavToolbox, "").direction === "rtl") ? 'bottomcenter topright' : 'bottomcenter topleft';
    this.panel.openPopup(anchor, position, 0, 0, false, false);
  },

  installApp: function(message) {
    let manifestUrl = message.app;
    let self = this;
    let {FFRepoImplService} = require("api");
    var args = {
      url: manifestUrl,
      hidePostInstallPrompt: true, // don't want the app panel to appear.
      onerror: function(errob) {
        // TODO: should probably consider notifying the content of the error
        // so it can do something useful.
        console.log("Failed to install " + manifestUrl + ": " + errob.code + ": " + errob.message);
      },
      onsuccess: function() {
        // Note the app being installed will have triggered the
        // 'openwebapp-installed' observer, which will in-turn have posted
        // a message to the content.
        console.log("successful install of", manifestUrl);
      }
    };
    // Hrmph - need to use an installOrigin of the hard-coded OWA app store
    console.log("requesting install of", manifestUrl);
    FFRepoImplService.install('http://localhost:8420',
                              args,
                              undefined); // the window is only used if a prompt is shown.
  }
};

exports.sharePanelHelper = sharePanelHelper;
