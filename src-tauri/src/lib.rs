use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProxyArgs {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
}

#[derive(Serialize)]
struct ProxyResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

/// Transparently forwards a frontend request: url, method, headers, body.
/// Bypasses the http plugin's URL allow-list by issuing the request directly.
#[tauri::command]
async fn proxy(args: ProxyArgs) -> Result<ProxyResponse, String> {
    let method = reqwest::Method::from_bytes(
        args.method.unwrap_or_else(|| "GET".to_string()).as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, &args.url);

    if let Some(headers) = args.headers {
        let mut map = reqwest::header::HeaderMap::new();
        for (k, v) in headers {
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| e.to_string())?;
            let value = reqwest::header::HeaderValue::from_str(&v)
                .map_err(|e| e.to_string())?;
            map.append(name, value);
        }
        builder = builder.headers(map);
    }

    if let Some(body) = args.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();

    // Fold duplicate headers (e.g. Set-Cookie) into a comma-separated value.
    let mut resp_headers: HashMap<String, String> = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(val) = v.to_str() {
            resp_headers
                .entry(k.as_str().to_string())
                .and_modify(|existing| {
                    existing.push_str(", ");
                    existing.push_str(val);
                })
                .or_insert_with(|| val.to_string());
        }
    }

    let body = resp
        .bytes()
        .await
        .map_err(|e| e.to_string())?
        .to_vec();

    Ok(ProxyResponse {
        status,
        headers: resp_headers,
        body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, proxy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
