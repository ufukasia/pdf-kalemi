package io.github.ufukasia.pdfkalemi;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Uygulamanın kendi eklentisi: "Birlikte aç" / "Paylaş" ile gelen PDF'ler.
        registerPlugin(PdfKalemiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
