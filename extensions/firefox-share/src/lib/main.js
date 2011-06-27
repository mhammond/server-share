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

const self = require("self");
const unload = require("unload");

const {Cc, Ci, Cm, Cu, components} = require("chrome");

const FFSHARE_EXT_ID = "ffshare@mozilla.org";

let tmp = {};
Cu.import("resource://gre/modules/Services.jsm", tmp);
let {Services} = tmp;

let {LocationChangeProgressListener} = require("progress");

let {installOverlay} = require("overlay");
let {getString} = require("addonutils");
let jetpackOptions;

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const SHARE_BUTTON_ID = "share-button";

const EXPORTED_SYMBOLS = ["installFFShareIntoWindow"];

/**
 * Install the 'ffshare' object into a window. Returns an array of
 * unloader functions.
 */
function installFFShareIntoWindow(win) {
    win.ffshare = new FFShare(win);
    let unloaders = [];
    /* By the time the unloader is called, win.ffshare is already undefined
    unloaders.push(function () {
        win.ffshare.unload();
        win.ffshare = null;
    });
    */
    return unloaders;
}

function log(msg) {
    console.log(msg);
    dump(msg+"\n");
    Cu.reportError('.' + msg); // avoid clearing on empty log
}

function error(msg) {
    console.error(msg);
    dump(msg+"\n");
    Cu.reportError('.' + msg); // avoid clearing on empty log
}

function sendJustInstalledEvent(win, url) {
  var buttonNode = win.document.getElementById(SHARE_BUTTON_ID);
  //Button may not be there if customized and removed from toolbar.
  if (buttonNode) {
    var tab = win.gBrowser.loadOneTab(url, { referrerURI: null,
                                             charset: null,
                                             postData: null,
                                             inBackground: false,
                                             allowThirdPartyFixup: null });
    // select here and there in case the load was quick
    win.gBrowser.selectedTab = tab;
    tab.addEventListener("load", function tabevent() {
      tab.removeEventListener("load", tabevent, true);
      win.gBrowser.selectedTab  = tab;
    }, true);
    buttonNode.setAttribute("firstRun", "true");
  }
}

function makeInstalledLoadHandler(win, url) {
  var handler = function () {
    win.removeEventListener("load", handler, true);
    sendJustInstalledEvent(win, url);
  };
  return handler;
}

//Taken from https://developer.mozilla.org/en/Code_snippets/Tabbed_browser
function openAndReuseOneTabPerURL(url) {
  var browserEnumerator = Services.wm.getEnumerator("navigator:browser"),
      rect, browser, buttonNode;
  // Check each browser instance for our URL
  var found = false;
  try {
    while (!found && browserEnumerator.hasMoreElements()) {
      var browserWin = browserEnumerator.getNext();
      var tabbrowser = browserWin.gBrowser;

      // Sometimes we don't get a tabbrowser element
      if (tabbrowser) {
        // Check each tab of this browser instance
        var numTabs = tabbrowser.browsers.length;
        for (var index = 0; index < numTabs; index++) {
          var currentBrowser = tabbrowser.getBrowserAtIndex(index);
          if (currentBrowser.currentURI &&
              url === currentBrowser.currentURI.spec) {

            // The URL is already opened. Select this tab.
            tabbrowser.selectedTab = tabbrowser.tabContainer.childNodes[index];

            // Focus *this* browser-window
            browserWin.focus();

            buttonNode = browserWin.document.getElementById(SHARE_BUTTON_ID);
            //Button may not be there if customized and removed from toolbar.
            if (buttonNode) {
              buttonNode.setAttribute("firstRun", "true");
            }

            found = true;
            break;
          }
        }
      }
    }
  // Minefield likes to error out in this loop sometimes
  } catch (ignore) { }

  // Our URL isn't open. Open it now.
  if (!found) {
    var recentWindow = Services.wm.getMostRecentWindow("navigator:browser");
    if (recentWindow) {
      // If our window is opened and ready just open the tab
      //   possible values: (loading, complete, or uninitialized)
      if (recentWindow.document.readyState === "complete") {
        sendJustInstalledEvent(recentWindow, url);
      } else {
        // Otherwise the window, while existing, might not be ready yet so we wait to open our tab
        recentWindow.addEventListener("load", makeInstalledLoadHandler(recentWindow, url), true);
      }
    }
    else {
      // No browser windows are open, so open a new one.
      this.window.open(url);
    }
  }
}

function createMediator() {
    // create our 'helper' object - we will pass it the iframe once we
    // get the onshow callback.
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    let ffshare = new FFShare(win);
    console.log("creating mediator with window", win, "and doc", win.document);
    let {sharePanelHelper} = require("panel");
    let panelHelper = new sharePanelHelper(win, ffshare);
    return {
        url: ffshare.prefs.share_url,
        anchor: win.document.getElementById('share-button'),
        updateargs: function(contentargs) {
            return panelHelper.getOptions(contentargs);
        },
        onshow: function(iframe) {
            panelHelper.browser = iframe;
            panelHelper.panelShown();
        },
        onhide: function(iframe) {
            console.log("got onhide callback");
            panelHelper.panelHidden();
            panelHelper.browser = null;
        },
        onresult: function(req) {
            return panelHelper.onMediatorCallback(req);
        }
    };
}

function FFShare(win) {
    this.window = win;

    // Hang on, the window may not be fully loaded yet
    let self = this;
    function checkWindow() {
        if (win.document.readyState !== "complete") {
            let timeout = win.setTimeout(checkWindow, 1000);
            unloaders.push(function() win.clearTimeout(timeout));
        } else {
            self.init();
        }
    }
    checkWindow();
}

FFShare.prototype = {
    keycodeId: "key_ffshare",
    keycode : "VK_F1",
    oldKeycodeId: "key_old_ffshare",

    invoke: function(options) {
        // invoke the service.
        this.services.invoke(this.window, "link.send", options,
                        function() {
                            console.log("send was success");
                        },
                        function(err) {
                            console.error("Failed to invoke share service", err);
                        });
    },

    canShareURI: function (aURI) {
      var command = this.window.document.getElementById("cmd_toggleSharePage");
      let button = this.window.document.getElementById(SHARE_BUTTON_ID);
      try {
        if (this.isValidURI(aURI)) {
          command.removeAttribute("disabled");
          button.hidden = false;
        } else {
          command.setAttribute("disabled", "true");
          button.hidden = true;
        }
      } catch (e) {
        throw e;
      }
    },

    isValidURI: function (aURI) {
      // Only open the share frame for http/https/ftp urls, file urls for testing.
      return (aURI && (aURI.schemeIs('http') || aURI.schemeIs('https') ||
                       aURI.schemeIs('file') || aURI.schemeIs('ftp')));
    },

    installAPI: function() {
        // Inject code into content
        tmp = {};
        let self = this;
        Cu.import("resource://ffshare/modules/injector.js", tmp);
        let ffapi = {
            apibase: null, // null == 'navigator.mozilla.labs'
            name: 'share', // builds to 'navigator.mozilla.labs.share'
            script: null, // null == use injected default script
            getapi: function () {
                return function (options) {
                    self.togglePanel(options);
                };
            }
        };
        tmp.InjectorInit(self.window);
        self.window.injector.register(ffapi);
    },

    init: function() {

        // Load FUEL to access Application and setup preferences
        let Application = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);
        this.prefs = {
            system: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".system",
                "prod"
            ),
            share_url: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".share_url",
                "https://f1.mozillamessaging.com/share/panel/"
            ),
            frontpage_url: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".frontpage_url",
                "http://f1.mozillamessaging.com/"
            ),
            bookmarking: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".bookmarking",
                true
            ),
            previous_version: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".previous_version",
                ""
            ),

            // Cannot rename firstRun to first_install since it would mess
            // up already deployed clients, would pop a new F1 window on
            // an upgrade vs. fresh install.
            firstRun: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".first-install",
                true
            ),
            use_accel_key: Application.prefs.getValue(
                "extensions." + FFSHARE_EXT_ID + ".use_accel_key",
                true
            )
        };

        // dev and staging settings are based on the system pref
        if (this.prefs.system === 'dev') {
          this.prefs.share_url = 'http://linkdrop.caraveo.com:5000/1/share/panel/';
        } else if (this.prefs.system === 'staging') {
          this.prefs.share_url = 'https://f1-staging.mozillamessaging.com/share/panel/';
        }

        if (this.prefs.system === 'dev') {
          this.prefs.frontpage_url = 'http://linkdrop.caraveo.com:5000/1';
        } else if (this.prefs.system === 'staging') {
          this.prefs.frontpage_url = 'http://f1-staging.mozillamessaging.com/';
        }

        let addon_version = jetpackOptions.metadata.ffshare.version;
        this.onInstallUpgrade(addon_version);
        try {
            this.canShareProgressListener = new LocationChangeProgressListener(this);
            this.window.gBrowser.addProgressListener(this.canShareProgressListener);
        } catch (e) {
            error(e);
        }

        this.onContextMenuItemShowing = function(e) {
            self._onContextMenuItemShowing(e);
        }
        this.window.document.getElementById("contentAreaContextMenu").addEventListener("popupshowing", this.onContextMenuItemShowing, false);

        this.initKeyCode();

        Services.prefs.addObserver("extensions." + FFSHARE_EXT_ID + ".", this, false);

        //Events triggered by TabView (panorama)
        this.tabViewShowListener = function() { self.onTabViewShow() };
        this.tabViewHideListener = function() { self.onTabViewHide() };
        this.window.addEventListener('tabviewshow', this.tabViewShowListener, false);
        this.window.addEventListener('tabviewhide', this.tabViewHideListener, false);

        // tell OWA that we want to handle the link.send service
        // (this need be done only once, but multiple times doesn't hurt - yet!)
        let {serviceInvocationHandler} = require("services");
        this.services = new serviceInvocationHandler(this.window);
        this.services.registerMediator("link.send", function() {
            return createMediator();
        });
    },

    unload: function() {
        try {
            this.window.gBrowser.removeProgressListener(this.canShareProgressListener);
        } catch (e) {
            error(e);
        }

        this.window.document.getElementById("contentAreaContextMenu").removeEventListener("popupshowing", this.onContextMenuItemShowing, false);

        //Events triggered by TabView (panorama)
        this.window.removeEventListener('tabviewshow', this.tabViewShowListener, false);
        this.window.removeEventListener('tabviewhide', this.tabViewHideListener, false);
        this.tabViewShowListener = null;
        this.tabViewHideListener = null;
    },

    onInstallUpgrade: function (version) {
      this.version = version;

      //Only run if the versions do not match.
      if (version === this.prefs.previous_version) {
        return;
      }
      let Application = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);

      this.prefs.previous_version = version;
      Application.prefs.setValue("extensions." + FFSHARE_EXT_ID + ".previous_version", version);

      if (this.prefs.firstRun) {
        //Make sure to set the pref first to avoid bad things if later code
        //throws and we cannot set the pref.
        this.prefs.firstRun = false;
        Application.prefs.setValue("extensions." + FFSHARE_EXT_ID + ".first-install", false);
        openAndReuseOneTabPerURL(this.prefs.frontpage_url);
      }
    },

    // This function is to be run once at onLoad
    // Checks for the existence of key code already and saves or gives it an ID for later
    // We could get away without this check but we're being nice to existing key commands
    initKeyCode: function () {
      var keys = this.window.document.getElementsByTagName("key");
      for (var i = 0; i < keys.length; i++) {
        // has the keycode we want to take and isn't already ours
        if (this.keycode === keys[i].getAttribute("keycode") &&
            this.keycodeId !== keys[i].id) {

          if (keys[i].id) {
            this.oldKeycodeId = keys[i].id;
          }
          else {
            keys[i].id = this.oldKeycodeId;
          }

          break;
        }
      }
      this.setAccelKey(this.prefs.use_accel_key);
    },

    _onContextMenuItemShowing: function (e) {
      try {
        let contextMenu = this.window.gContextMenu;
        let document = this.window.document;
        let hide = (contextMenu.onTextInput || contextMenu.onLink ||
                    contextMenu.onImage || contextMenu.isContentSelected ||
                    contextMenu.onCanvas || contextMenu.onVideo ||
                    contextMenu.onAudio);
        let hideSelected = (contextMenu.onTextInput || contextMenu.onLink ||
                            !contextMenu.isContentSelected ||
                            contextMenu.onImage || contextMenu.onCanvas ||
                            contextMenu.onVideo || contextMenu.onAudio);

        document.getElementById("context-ffshare").hidden = hide;
        document.getElementById("context-ffshare-separator").hidden = hide;

        document.getElementById("context-selected-ffshare").hidden = hideSelected;
        document.getElementById("context-selected-ffshare-separator").hidden = hideSelected;
      } catch (e) { }
    },

    observe: function (subject, topic, data) {
      if (topic !== "nsPref:changed") {
        return;
      }

      let pref = subject.QueryInterface(Ci.nsIPrefBranch);
      //dump("topic: " + topic + " -- data: " + data + " == pref: " + pref.getBoolPref(data) + "\n");
      if ("extensions." + FFSHARE_EXT_ID + ".use_accel_key" === data) {
        try {
          this.setAccelKey(pref.getBoolPref(data));
        } catch (e) {
          error(e);
        }
      } else if ("extensions." + FFSHARE_EXT_ID + ".bookmarking" === data) {
        try {
          this.prefs.bookmarking = pref.getBoolPref(data);
        } catch (e) {
          error(e);
        }
      }
    },

    setAccelKey: function (keyOn) {
      let document = this.window.document,
          oldKey = document.getElementById(this.oldKeycodeId),
          f1Key = document.getElementById(this.keycodeId),
          keyset = document.getElementById("mainKeyset"),
          p;

      if (keyOn) {
        try {
          if (oldKey) {
            oldKey.setAttribute("keycode", "");
          }
          f1Key.setAttribute("keycode", this.keycode);
        } catch (e) {
          error(e);
        }
      } else {
        try {
          f1Key.setAttribute("keycode", "");
          if (oldKey) {
            oldKey.setAttribute("keycode", this.keycode);
          }
        } catch (e) {
          error(e);
        }
      }

      // now we invalidate the keyset cache so our changes take effect
      p = keyset.parentNode;
      p.appendChild(p.removeChild(keyset));

    },

    onTabViewShow: function (event) {
      // Triggered by TabView (panorama). Always hide it if being shown.
      if (this.window.document.getElementById('share-popup').state === 'open') {
        this.sharePanel.hide();
      }
    },

    onTabViewHide: function (event) {
      // Triggered by TabView (panorama). Restore share panel if needed.
      // Hmm this never seems to be called? browser-tabview.js shows
      // creation of a 'tabviewhide' event, but this function does
      // not seem to be called.
      this.switchTab();
    }

};

let unloaders = [];

function loadIntoWindow(win) {
  // overlay.js must export installOverlay.  installOverlay returns a
  // array of functions that are called during unload.

  try {
    log("install addon\n");
    unloaders = installOverlay(win);
    unloaders.push.apply(unloaders, installFFShareIntoWindow(win));
  } catch(e) {
    log("load error "+e+"\n");
  }
}

function eachWindow(callback) {
  let enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    let win = enumerator.getNext();
    if (win.document.readyState === "complete") {
      callback(win);
    } else {
      runOnLoad(win, callback);
    }
  }
}

function runOnLoad(window, callback) {
  window.addEventListener("load", function onLoad() {
    window.removeEventListener("load", onLoad, false);
    callback(window);
  }, false);
}

function windowWatcher(subject, topic) {
  if (topic !== "domwindowopened") {
    return;
  }
  let win = subject.QueryInterface(Ci.nsIDOMWindow);
  // We don't know the type of the window at this point yet, only when
  // the load event has been fired.
  runOnLoad(win, function (win) {
    let doc = win.document.documentElement;
    if (doc.getAttribute("windowtype") == "navigator:browser") {
      loadIntoWindow(win);
    }
  });
}

function registerResource(installPath, name) {
    let resource = Services.io.getProtocolHandler("resource")
                   .QueryInterface(Ci.nsIResProtocolHandler);
    let alias = Services.io.newFileURI(installPath);
    if (!installPath.isDirectory())
        alias = Services.io.newURI("jar:" + alias.spec + "!/", null, null);
    resource.setSubstitution(name, alias);
}

function getAddonShortName(name) {
  return name.split('@')[0];
}

exports.main = function(options, callbacks) {
    // just the 'require' of this module boostraps the world.
    jetpackOptions = options;
    let owa = require("openwebapps/main");

    /* Setup l10n, getString is loaded from addonutils */
    getString.init();

    eachWindow(loadIntoWindow);

    Services.ww.registerNotification(windowWatcher);
    unloaders.push(function() Services.ww.unregisterNotification(windowWatcher));
    // Hook up unloaders
    unload.when(shutdown);
};

function shutdown(reason) {
    // variable why is one of 'uninstall', 'disable', 'shutdown', 'upgrade' or
    // 'downgrade'. doesn't matter now, but might later
    unloaders.forEach(function(unload) unload && unload());
}

