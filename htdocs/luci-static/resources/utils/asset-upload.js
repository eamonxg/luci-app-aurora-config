"use strict";
"require baseclass";
"require rpc";
"require ui";

// Shared upload plumbing for the config UI. Two surfaces consume it (custom
// fonts, brand asset library); anything font- or image-specific stays with
// the caller -- this module only knows about files, bytes, and the
// cgi-upload channel.

const MAX_UPLOAD = 8 * 1024 * 1024;

const formatSize = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

return baseclass.extend({
  MAX_UPLOAD,

  formatSize,

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

  // Persistent dropzone: click / drag-drop / keyboard. Returns the element
  // with a setBusy(bool) method for the upload-in-flight state.
  createDropzone(opts) {
    const input = E("input", {
      type: "file",
      style: "display:none",
      accept: opts.accept || "",
    });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) opts.onFile(file);
    });

    const zone = E(
      "div",
      {
        style:
          "border:2px dashed var(--hairline);border-radius:0.5em;padding:" +
          (opts.compact ? "0.9em 1em" : "1.25em 1em") +
          ";text-align:center;cursor:pointer;transition:border-color 0.15s,background 0.15s;",
        tabindex: "0",
        role: "button",
        click: () => input.click(),
        keydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.click();
          }
        },
        dragover: (e) => {
          e.preventDefault();
          zone.style.borderColor = "var(--brand)";
          zone.style.background = "var(--brand-subtle)";
        },
        dragleave: () => {
          zone.style.borderColor = "";
          zone.style.background = "";
        },
        drop: (e) => {
          e.preventDefault();
          zone.style.borderColor = "";
          zone.style.background = "";
          const file = e.dataTransfer && e.dataTransfer.files[0];
          if (file) opts.onFile(file);
        },
      },
      [
        E(
          "div",
          { style: "font-size:1.5em;margin-bottom:0.25em;pointer-events:none;" },
          "⬆",
        ),
        E("strong", { style: "pointer-events:none;" }, opts.hint),
        opts.sub
          ? E(
              "div",
              {
                style:
                  "font-size:0.8em;opacity:0.6;margin-top:0.25em;pointer-events:none;",
              },
              opts.sub,
            )
          : "",
        input,
      ],
    );

    zone.setBusy = (busy) => {
      zone.style.opacity = busy ? "0.5" : "";
      zone.style.pointerEvents = busy ? "none" : "";
    };
    return zone;
  },

  createProgressRow() {
    const bar = E("div", {
      style:
        "height:100%;width:0%;transition:width 0.15s;border-radius:2px;background:var(--brand);",
    });
    const filename = E("span", {}, "");
    const pct = E("span", {}, "0%");
    const el = E(
      "div",
      {
        style:
          "display:none;margin-bottom:0.75em;padding:0.6em 0.875em;border-radius:0.375em;border:1px solid var(--hairline);",
      },
      [
        E(
          "div",
          {
            style:
              "display:flex;justify-content:space-between;align-items:center;font-size:0.85em;margin-bottom:0.4em;",
          },
          [filename, pct],
        ),
        E(
          "div",
          {
            style:
              "height:4px;border-radius:2px;overflow:hidden;background:var(--surface-sunken);",
          },
          [bar],
        ),
      ],
    );
    return {
      el,
      set(p, name) {
        if (name != null) filename.textContent = name;
        bar.style.width = p + "%";
        pct.textContent = p + "%";
      },
      show() {
        el.style.display = "block";
      },
      hide() {
        el.style.display = "none";
      },
    };
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
