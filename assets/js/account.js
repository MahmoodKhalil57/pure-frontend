/* ===========================================================================
   Signing in from the website.

   The node is the account system; this file is only the form in front of it.
   Two endpoints do everything: `/api/public/signup` makes an account, and
   Better Auth's own `/api/auth/sign-in/email` mints the session. Sign-up is a
   separate endpoint on purpose — it is the one door nobody was invited through,
   so the role it hands out is decided by the node and cannot be asked for here.

   The backend address comes from content/site.json, the same place the forms
   read it from, so a site that moves to a custom domain follows without an
   edit here.
   =========================================================================== */

(function () {
  "use strict";

  var BASE = new URL(".", location.href);

  function api(content, path) {
    var backend = (content && content.backend) || {};
    var root = String(backend.url || "").replace(/\/+$/, "");
    return root ? root + "/api" + path : "";
  }

  function el(id) {
    return document.getElementById(id);
  }

  function say(node, message, kind) {
    if (!node) return;
    node.textContent = message || "";
    node.dataset.state = kind || "";
    node.hidden = !message;
  }

  /* Credentials travel on every call: the session is a cookie, and on a custom
     domain the site and the API are the same origin anyway. */
  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (parsed) {
          return { ok: response.ok, status: response.status, body: parsed };
        });
    });
  }

  function whoami(root) {
    return fetch(root + "/api/auth/get-session", { credentials: "include" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function paint(session) {
    var signedIn = Boolean(session && session.user);
    var forms = el("account-forms");
    var welcome = el("account-welcome");
    if (forms) forms.hidden = signedIn;
    if (welcome) welcome.hidden = !signedIn;
    if (signedIn) {
      var name = el("account-name");
      if (name) name.textContent = session.user.name || session.user.email;
    }
  }

  fetch(new URL("content/site.json", BASE).href, { cache: "no-cache" })
    .then(function (response) {
      return response.ok ? response.json() : {};
    })
    .catch(function () {
      return {};
    })
    .then(function (content) {
      var signupUrl = api(content, "/public/signup");
      var signinUrl = api(content, "/auth/sign-in/email");
      var root = signupUrl.replace(/\/api\/public\/signup$/, "");

      if (!signupUrl) {
        say(
          el("account-status"),
          "This site is not connected to a backend yet.",
          "error",
        );
        return;
      }

      whoami(root).then(paint);

      var signup = el("signup-form");
      if (signup) {
        signup.addEventListener("submit", function (event) {
          event.preventDefault();
          var status = el("signup-status");
          say(status, "Creating your account…");

          var email = signup.querySelector('[name="email"]').value;
          var password = signup.querySelector('[name="password"]').value;
          var name = signup.querySelector('[name="name"]').value;

          post(signupUrl, { email: email, password: password, name: name })
            .then(function (result) {
              if (!result.ok) {
                say(status, result.body.error || "That did not work.", "error");
                return null;
              }
              // Straight in: the account exists, so the next step is the same
              // one an existing visitor takes.
              return post(signinUrl, { email: email, password: password });
            })
            .then(function (result) {
              if (!result) return;
              if (!result.ok) {
                say(
                  status,
                  "Account created. Sign in with it below.",
                  "",
                );
                return;
              }
              say(status, "");
              whoami(root).then(paint);
            })
            .catch(function () {
              say(status, "Could not reach the server.", "error");
            });
        });
      }

      var signin = el("signin-form");
      if (signin) {
        signin.addEventListener("submit", function (event) {
          event.preventDefault();
          var status = el("signin-status");
          say(status, "Signing in…");

          post(signinUrl, {
            email: signin.querySelector('[name="email"]').value,
            password: signin.querySelector('[name="password"]').value,
          })
            .then(function (result) {
              if (!result.ok) {
                say(status, "That email and password did not match.", "error");
                return;
              }
              say(status, "");
              whoami(root).then(paint);
            })
            .catch(function () {
              say(status, "Could not reach the server.", "error");
            });
        });
      }

      var out = el("signout");
      if (out) {
        out.addEventListener("click", function () {
          post(root + "/api/auth/sign-out", {}).then(function () {
            paint(null);
          });
        });
      }
    });
})();
