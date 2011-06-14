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
 * The Initial Developer of the Original Code is The Mozilla Foundation.
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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

let unloaders = [];

function loadIntoWindow(win) {
  try {
    dump("install addon\n");
    unloaders = installOverlay(win);
    unloaders.push.apply(unloaders, installFFShareIntoWindow(win));
  } catch(e) {
    dump("load error "+e+"\n");
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

function startup(data, reason) AddonManager.getAddonByID(data.id, function(addon) {
    // XXX the purpose for the shortname is to auto-build a resource url that
    // is then used by the addon.  This requires the addon have an id that
    // is in the name@domain format.  'name' will become the domain for the
    // resource.  A better mechanism for this would be great.

    let id = getAddonShortName(data.id);
    registerResource(data.installPath, id);

    // load support utililities that need to be accessible from more than
    // just bootstrap
    Cu.import("resource://"+id+"/modules/addonutils.js");

    // overlay.js must export installOverlay.  installOverlay returns a
    // array of functions that are called during unload.
    Cu.import("resource://"+id+"/modules/overlay.js");

    // load startAddon.  This is where the addon logic should actually start.
    Cu.import("resource://"+id+"/modules/main.js");

    // Install our "apps" - but note XXX:
    // * The OWA addon might not have initialized yet, so do all that async.
    // * we need to query the F1 server for what it knows about until we
    //   can rely on OWA for this discovery - but for now the list is
    //   hardcoded below.
    // * this is almost certainly the wrong place to do this!
    AddonManager.getAddonByID("openwebapps@mozillalabs.com", function(owa) {
      // Note - 'owa' will be null if it doesn't exist...
      Cu.import("resource://openwebapps/modules/api.js");
      if (FFRepoImplService) {
        // need a window to register the app...
        var browser = Services.wm.getMostRecentWindow("navigator:browser");
        var apps = ["http://linkdrop.caraveo.com:5000/1/apps/facebook.webapp",
                    "http://localhost:5000/1/apps/twitter.webapp"];
        apps.forEach(function(app) {
          var args = {
            url: app,
            onerror: function(errob) {
              dump("Failed to install " + app + ": " + errob.code + ": " + errob.message + "\n");
            },
            onsuccess: function() {
              dump("Installed app " + app + "\n");
            }
          }
          // Hrmph - need to use an installOrigin of the hard-coded OWA app store
          FFRepoImplService.install('http://localhost:8420',
                                    args,
                                    browser);
        });
      } else {
        dump("Can't install apps - failed to get FFRepoImplService\n");
      }
    });

    /* Setup l10n, getString is loaded from addonutils */
    getString.init(addon);

    dump("init windows\n");
    eachWindow(loadIntoWindow);

    Services.ww.registerNotification(windowWatcher);
    unloaders.push(function() Services.ww.unregisterNotification(windowWatcher));
});

function shutdown(data, reason) {
    if (reason == APP_SHUTDOWN) return;

    let id = getAddonShortName(data.id);
    let resource = Services.io.getProtocolHandler("resource")
                   .QueryInterface(Ci.nsIResProtocolHandler);
    resource.setSubstitution(id, null);
    unloaders.forEach(function(unload) unload && unload());
}

function install() {
}

function uninstall() {
}
