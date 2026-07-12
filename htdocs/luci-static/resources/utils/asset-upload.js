"use strict";
"require baseclass";
"require rpc";
"require ui";

// Shared upload plumbing for the config UI. Two surfaces consume it (custom
// fonts, brand asset library); anything font- or image-specific stays with
// the caller -- this module only knows about files, bytes, and the
// cgi-upload channel.

const MAX_UPLOAD = 8 * 1024 * 1024;

const formatSize = (bytes) =>
  bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.round(bytes / 1024) + " KB";

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

return baseclass.extend({
  MAX_UPLOAD,

  formatSize,

  extOf,

  // Pure pre-check for instant feedback; the rpcd receive_upload gate stays
  // authoritative. exts is a lowercase list without dots, e.g. ["woff2"].
  checkFile(file, opts) {
    const exts = opts?.exts || [];
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    if (exts.length && !exts.includes(ext))
      return {
        ok: false,
        err: _("Unsupported file type. Allowed: %s").format(exts.join(", ")),
      };
    if (file.size > MAX_UPLOAD)
      return {
        ok: false,
        err: _("File is %s, exceeding the 8MB limit.").format(
          formatSize(file.size),
        ),
      };
    return { ok: true, err: "" };
  },

  // XHR to /cgi-bin/cgi-upload. Resolves on HTTP 200; the caller still has
  // to run its own RPC confirm (upload_font / upload_icon) afterwards.
  uploadToRouter(opts) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      if (opts.onProgress)
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable)
            opts.onProgress(Math.round((e.loaded / e.total) * 100));
        });

      xhr.addEventListener("load", () =>
        xhr.status === 200
          ? resolve()
          : reject(new Error(_("Upload failed (HTTP %s)").format(xhr.status))),
      );
      xhr.addEventListener("error", () =>
        reject(new Error(_("Upload failed"))),
      );

      const formData = new FormData();
      formData.append("sessionid", rpc.getSessionID());
      formData.append("filename", opts.tmpPath);
      formData.append("filemode", "0600");
      formData.append("filedata", opts.file, opts.file.name);

      xhr.open("POST", "/cgi-bin/cgi-upload");
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  },

  // Composite "asset manager": a table (preview | name | badge | size | ✕)
  // sitting on a dock that shows either the slim upload bar, the in-place
  // confirm form, or a progress row -- never more than one at a time. Both
  // custom-fonts and the brand asset library render through this; the only
  // per-kind knowledge lives in the caller's row/bar/form/checkFile/upload
  // callbacks. See prototype v3 variant A (font-upload-proto.html) for the
  // interaction blueprint this replicates.
  //
  // cfg = {
  //   badgeHeader,                 // _("Slot") or _("Type")
  //   emptyText,
  //   rows: [{ preview, name, badge: { label, tone }, size, onDelete() }],
  //   bar: { hint, sub, accept },
  //   checkFile(file) -> { ok, err },
  //   form: { fields(file) -> { el, value(), valid() }, note },
  //   upload(file, meta, onProgress) -> Promise,   // caller composes
  //                                                // uploadToRouter + RPC
  // }
  createAssetManager(cfg) {
    const rows = cfg.rows || [];
    const th = (width) =>
      "text-align:left;font-size:0.72em;color:var(--text-muted);" +
      "font-weight:600;letter-spacing:0.03em;padding:0.4em 0.75em;" +
      "background:var(--surface-sunken);border-bottom:1px solid var(--hairline);" +
      (width ? "width:" + width + "px;" : "");
    const td =
      "padding:0.45em 0.75em;border-bottom:1px solid var(--hairline);" +
      "vertical-align:middle;";
    const badgeStyle = (tone) =>
      "display:inline-block;font-size:0.68em;font-weight:700;" +
      "letter-spacing:0.03em;padding:0.08em 0.55em;border-radius:999px;" +
      "white-space:nowrap;" +
      (tone === "brand"
        ? "background:var(--brand-subtle);color:var(--brand);"
        : "background:var(--surface-sunken);color:var(--text-muted);" +
          "border:1px solid var(--hairline);");

    const shell = E("div", {
      style:
        "border:1px solid var(--hairline);border-radius:var(--radius-base);" +
        "overflow:hidden;",
    });

    if (rows.length) {
      shell.appendChild(
        E(
          "table",
          { style: "width:100%;border-collapse:collapse;font-size:0.9em;" },
          [
            E("thead", {}, [
              E("tr", {}, [
                E("th", { style: th(40) }, ""),
                E("th", { style: th() }, _("Name")),
                E("th", { style: th(76) }, cfg.badgeHeader),
                E("th", { style: th(84) }, _("Size")),
                E("th", { style: th(40) }, ""),
              ]),
            ]),
            E(
              "tbody",
              {},
              rows.map((row) =>
                E("tr", {}, [
                  E("td", { style: td }, row.preview),
                  E(
                    "td",
                    { style: td + "font-weight:600;word-break:break-all;" },
                    row.name,
                  ),
                  E(
                    "td",
                    { style: td },
                    row.badge
                      ? E(
                          "span",
                          { style: badgeStyle(row.badge.tone) },
                          row.badge.label,
                        )
                      : "",
                  ),
                  E(
                    "td",
                    {
                      style:
                        td +
                        "color:var(--text-muted);font-variant-numeric:tabular-nums;" +
                        "white-space:nowrap;",
                    },
                    formatSize(row.size || 0),
                  ),
                  E(
                    "td",
                    { style: td },
                    E(
                      "button",
                      {
                        type: "button",
                        class: "cbi-button",
                        title: _("Delete"),
                        style: "padding:0.15em 0.5em;line-height:1;",
                        click: row.onDelete,
                      },
                      "✕",
                    ),
                  ),
                ]),
              ),
            ),
          ],
        ),
      );
    } else {
      shell.appendChild(
        E(
          "div",
          {
            style:
              "padding:0.75em 0.9em;color:var(--text-muted);font-size:0.9em;" +
              "border-bottom:1px solid var(--hairline);",
          },
          cfg.emptyText,
        ),
      );
    }

    const dock = E("div", {});
    shell.appendChild(dock);

    const clearDock = () => {
      while (dock.firstChild) dock.firstChild.remove();
    };

    const renderBar = () => {
      clearDock();
      const input = E("input", {
        type: "file",
        style: "display:none;",
        accept: (cfg.bar && cfg.bar.accept) || "",
      });
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (file) onFile(file);
      });

      const bar = E(
        "button",
        {
          type: "button",
          style:
            "display:flex;align-items:center;gap:0.6em;width:100%;" +
            "padding:0.6em 0.9em;background:var(--surface-sunken);" +
            "border:0;border-top:1px solid var(--hairline);text-align:left;" +
            "cursor:pointer;color:var(--text);font:inherit;",
          click: () => input.click(),
          dragover: (e) => {
            e.preventDefault();
            bar.style.background = "var(--brand-subtle)";
          },
          dragleave: () => {
            bar.style.background = "var(--surface-sunken)";
          },
          drop: (e) => {
            e.preventDefault();
            bar.style.background = "var(--surface-sunken)";
            const file = e.dataTransfer && e.dataTransfer.files[0];
            if (file) onFile(file);
          },
        },
        [
          E(
            "span",
            {
              style:
                "width:26px;height:26px;border-radius:0.4em;flex:0 0 auto;" +
                "background:var(--brand-subtle);color:var(--brand);" +
                "display:flex;align-items:center;justify-content:center;" +
                "font-weight:800;",
            },
            "⬆",
          ),
          E("strong", { style: "font-size:0.93em;" }, cfg.bar.hint),
          E("span", { style: "flex:1;" }, ""),
          E(
            "span",
            { style: "color:var(--text-muted);font-size:0.89em;" },
            cfg.bar.sub || "",
          ),
          input,
        ],
      );

      dock.appendChild(bar);
    };

    const buildForm = (file, check) => {
      const fields = cfg.form.fields(file);

      const progressBar = E("div", {
        style:
          "height:100%;width:0%;transition:width 0.12s linear;" +
          "background:var(--brand);border-radius:999px;",
      });
      const progressWrap = E(
        "div",
        {
          style:
            "display:none;height:5px;border-radius:999px;" +
            "background:var(--hairline);overflow:hidden;",
        },
        [progressBar],
      );
      const setProgress = (p) => {
        progressBar.style.width = p + "%";
      };
      const showProgress = () => {
        progressWrap.style.display = "block";
      };
      const hideProgress = () => {
        progressWrap.style.display = "none";
        setProgress(0);
      };

      const fileLine = E(
        "div",
        { style: "display:flex;align-items:center;gap:0.55em;" },
        [
          E(
            "span",
            {
              style:
                "width:26px;height:26px;border-radius:0.4em;flex:0 0 auto;" +
                "background:var(--brand);color:var(--on-brand);" +
                "display:flex;align-items:center;justify-content:center;" +
                "font-size:0.68em;font-weight:800;",
            },
            extOf(file.name).toUpperCase().slice(0, 4),
          ),
          E(
            "span",
            {
              style:
                "font-weight:700;font-size:0.93em;word-break:break-all;",
            },
            file.name,
          ),
          E(
            "span",
            {
              style:
                "color:var(--text-muted);font-size:0.85em;white-space:nowrap;",
            },
            formatSize(file.size),
          ),
          E("span", { style: "flex:1;" }, ""),
          E(
            "button",
            {
              type: "button",
              class: "cbi-button",
              title: _("Remove file"),
              style: "padding:0.15em 0.5em;line-height:1;",
              click: renderBar,
            },
            "✕",
          ),
        ],
      );

      const errEl = check.ok
        ? null
        : E(
            "p",
            {
              style: "color:var(--danger);font-weight:600;font-size:0.9em;margin:0;",
            },
            check.err,
          );

      const goBtn = E(
        "button",
        { type: "button", class: "cbi-button cbi-button-positive" },
        _("Confirm Upload"),
      );
      const updateGoState = () => {
        goBtn.disabled = !check.ok || !fields.valid();
      };
      updateGoState();
      fields.el.addEventListener("input", updateGoState);
      fields.el.addEventListener("change", updateGoState);

      const fieldsRow = E(
        "div",
        {
          style:
            "display:flex;gap:0.6em;flex-wrap:wrap;align-items:center;",
        },
        [fields.el, E("span", { style: "flex:1;" }, ""), goBtn],
      );

      goBtn.addEventListener("click", () => {
        goBtn.disabled = true;
        showProgress();
        setProgress(0);
        const meta = fields.value();
        cfg
          .upload(file, meta, setProgress)
          .catch((err) => {
            hideProgress();
            updateGoState();
            ui.addNotification(
              null,
              E("p", _("Upload failed: %s").format(err.message)),
              "error",
            );
          });
      });

      const noteEl = cfg.form.note
        ? E(
            "div",
            { style: "font-size:0.82em;color:var(--text-muted);opacity:0.8;" },
            cfg.form.note,
          )
        : null;

      return E(
        "div",
        {
          style:
            "padding:0.75em 0.9em;background:var(--surface-sunken);" +
            "border-top:1px solid var(--hairline);display:flex;" +
            "flex-direction:column;gap:0.6em;",
        },
        [fileLine, errEl, fieldsRow, noteEl, progressWrap].filter(Boolean),
      );
    };

    const onFile = (file) => {
      const check = cfg.checkFile(file);
      clearDock();
      dock.appendChild(buildForm(file, check));
    };

    renderBar();
    return shell;
  },

  confirmDelete(opts) {
    return new Promise((resolve) => {
      ui.showModal(opts.title, [
        E("p", {}, opts.message),
        E("div", { class: "right" }, [
          E(
            "button",
            {
              class: "btn",
              click: () => {
                ui.hideModal();
                resolve(false);
              },
            },
            _("Cancel"),
          ),
          " ",
          E(
            "button",
            {
              class: "btn cbi-button-negative",
              click: () => {
                ui.hideModal();
                resolve(true);
              },
            },
            _("Delete"),
          ),
        ]),
      ]);
    });
  },
});
