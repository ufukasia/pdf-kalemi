package io.github.ufukasia.pdfkalemi;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * PDF Kalemi'nin Android'e özgü işleri:
 *  - Dışarıdan gelen PDF'ler: dosya yöneticisinde "Birlikte aç" (ACTION_VIEW) ya da "Paylaş" (ACTION_SEND).
 *    Web tarafı açılışta takePending() çağırır; uygulama açıkken gelen dosyalar için "pdfOpen" olayı yayımlanır.
 *  - Klasörlerim: Android'in klasör seçicisi (izin kalıcı tutulur), klasördeki PDF'leri listeleme ve okuma.
 * Dosyalar Android'in içerik çözücüsüyle okunur; gerçek adları da alınır.
 */
@CapacitorPlugin(name = "PdfKalemi")
public class PdfKalemiPlugin extends Plugin {
    private static final long MAX_BYTES = 300L * 1024 * 1024;
    private static final int MAX_FILES = 1500, MAX_DEPTH = 4;
    private Uri pending;

    @Override
    public void load() {
        pending = pdfUri(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri u = pdfUri(intent);
        if (u == null) return;
        pending = u;
        notifyListeners("pdfOpen", new JSObject(), true);
    }

    @SuppressWarnings("deprecation")
    private static Uri pdfUri(Intent i) {
        if (i == null) return null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) {
            // Yalnızca dosyalar; OneDrive girişinin dönüş bağlantısı (io.github.ufukasia.pdfkalemi://auth) PDF değildir.
            Uri d = i.getData();
            return d != null && ("content".equals(d.getScheme()) || "file".equals(d.getScheme())) ? d : null;
        }
        if (Intent.ACTION_SEND.equals(i.getAction())) return (Uri) i.getParcelableExtra(Intent.EXTRA_STREAM);
        return null;
    }

    /* ---------- Dışarıdan gelen PDF ---------- */

    /** Bekleyen PDF'i bir kez verir: { name, data (base64), size } ya da boş nesne. */
    @PluginMethod
    public void takePending(PluginCall call) {
        final Uri u = pending;
        pending = null;
        if (u == null) {
            call.resolve(new JSObject());
            return;
        }
        readInBackground(call, u, null);
    }

    /* ---------- Klasörlerim ---------- */

    /** Android'in klasör seçicisini açar; seçilen klasörün okuma izni kalıcı tutulur. Sonuç: { uri, name } ya da boş. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri tree = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Bazı sağlayıcılar kalıcı izin vermez; bu oturumda yine de okunabilir.
        }
        JSObject r = new JSObject();
        r.put("uri", tree.toString());
        r.put("name", docName(tree, DocumentsContract.getTreeDocumentId(tree)));
        call.resolve(r);
    }

    /** Klasördeki PDF'ler (alt klasörler dahil, 4 düzey): { files: [{ uri, name, rel }], truncated } ya da { missing: true }. */
    @PluginMethod
    public void listPdfs(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) {
            call.reject("klasör yok");
            return;
        }
        final Uri tree = Uri.parse(s);
        new Thread(() -> {
            JSObject r = new JSObject();
            JSArray out = new JSArray();
            try {
                walk(getContext().getContentResolver(), tree, DocumentsContract.getTreeDocumentId(tree), "", 0, out);
                r.put("files", out);
                r.put("truncated", out.length() >= MAX_FILES);
            } catch (Exception e) {
                r.put("missing", true);
                r.put("files", new JSArray());
            }
            call.resolve(r);
        }).start();
    }

    private void walk(ContentResolver cr, Uri tree, String docId, String rel, int depth, JSArray out) {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE };
        try (Cursor c = cr.query(kids, cols, null, null, null)) {
            if (c == null) throw new IllegalStateException("klasör okunamadı");
            while (c.moveToNext() && out.length() < MAX_FILES) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".") || name.startsWith("~$")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (depth < MAX_DEPTH) walk(cr, tree, id, rel.isEmpty() ? name : rel + "/" + name, depth + 1, out);
                } else if (name.toLowerCase().endsWith(".pdf")) {
                    JSObject f = new JSObject();
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    f.put("name", name);
                    f.put("rel", rel);
                    out.put(f);
                }
            }
        }
    }

    /** Klasördeki bir PDF'i okur: { name, data (base64), size }. */
    @PluginMethod
    public void readFile(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) {
            call.reject("dosya yok");
            return;
        }
        readInBackground(call, Uri.parse(s), call.getString("name"));
    }

    /* ---------- Ortak ---------- */

    private void readInBackground(PluginCall call, Uri u, String knownName) {
        new Thread(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(u)) {
                if (in == null) throw new Exception("dosya açılamadı");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[1 << 16];
                long total = 0;
                for (int n; (n = in.read(buf)) > 0; ) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("dosya çok büyük");
                    out.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("name", knownName != null ? knownName : displayName(u));
                r.put("size", total);
                r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("PDF okunamadı: " + e.getMessage());
            }
        }).start();
    }

    private String docName(Uri tree, String docId) {
        try (Cursor c = getContext().getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, docId),
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) {
        }
        String last = tree.getLastPathSegment();
        return last == null ? "Klasör" : last.substring(last.lastIndexOf(':') + 1);
    }

    private String displayName(Uri u) {
        String name = null;
        if ("content".equals(u.getScheme())) {
            try (Cursor c = getContext().getContentResolver().query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (name == null || name.isEmpty()) name = u.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "Belge.pdf";
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf";
    }
}
