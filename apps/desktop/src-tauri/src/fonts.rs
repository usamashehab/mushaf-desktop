//! The Mushaf's fonts: downloaded once on first launch, checked against their
//! sha256, kept in the app's data folder, and served to the page over the
//! `mushaf:` scheme (`http://mushaf.localhost` on Windows).

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// One font of a pack, as the reader lists it from the pack's manifest.
#[derive(Debug, Clone, Deserialize)]
pub struct FontFile {
    /// Where it lives under the fonts folder: "qcf-v2/p1.woff2", "extras/sura_names.woff2".
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub bytes: u64,
    pub total_bytes: u64,
}

/// The fonts folder: `MUSHAF_FONTS_DIR` when set (development reuses the build's
/// `.cache/fonts`), else `fonts/` in the app's data folder.
pub fn fonts_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("MUSHAF_FONTS_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("fonts"))
        .map_err(|error| error.to_string())
}

/// `name` under `dir`, refusing anything that would step outside it.
pub fn inside(dir: &Path, name: &str) -> Option<PathBuf> {
    let relative = Path::new(name);
    let is_plain = relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)));
    (is_plain && !name.is_empty()).then(|| dir.join(relative))
}

/// The files not yet on disk at their full size.
pub fn missing(dir: &Path, files: &[FontFile]) -> Vec<FontFile> {
    files
        .iter()
        .filter(|file| {
            inside(dir, &file.name)
                .and_then(|path| std::fs::metadata(path).ok())
                .map_or(true, |meta| meta.len() != file.size)
        })
        .cloned()
        .collect()
}

#[tauri::command]
pub fn fonts_missing<R: Runtime>(app: AppHandle<R>, files: Vec<FontFile>) -> Result<Vec<String>, String> {
    let dir = fonts_dir(&app)?;
    Ok(missing(&dir, &files).into_iter().map(|file| file.name).collect())
}

async fn fetch_checked(client: &reqwest::Client, file: &FontFile) -> Result<Vec<u8>, String> {
    let mut last = String::new();
    for attempt in 0..4u64 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(800 * attempt)).await;
        }
        let body = match client.get(&file.url).send().await.and_then(|r| r.error_for_status()) {
            Ok(response) => response.bytes().await,
            Err(error) => Err(error),
        };
        match body {
            Ok(body) => {
                let digest = format!("{:x}", Sha256::digest(&body));
                if digest == file.sha256 {
                    return Ok(body.to_vec());
                }
                last = format!("{}: checksum does not match", file.name);
            }
            Err(error) => last = format!("{}: {error}", file.name),
        }
    }
    Err(last)
}

/// Downloads every missing font, eight at a time, reporting `fonts-progress`.
/// A file is written under a temporary name and renamed once its sha256 matches,
/// so an interrupted download never leaves a broken font behind.
#[tauri::command]
pub async fn download_fonts<R: Runtime>(app: AppHandle<R>, files: Vec<FontFile>) -> Result<(), String> {
    let dir = fonts_dir(&app)?;
    let todo = missing(&dir, &files);
    let total = todo.len();
    let total_bytes: u64 = todo.iter().map(|file| file.size).sum();
    let done = Arc::new(AtomicUsize::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let client = reqwest::Client::builder()
        .user_agent(concat!("mushaf-desktop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let _ = app.emit("fonts-progress", Progress { done: 0, total, bytes: 0, total_bytes });

    let failures: Vec<String> = stream::iter(todo)
        .map(|file| {
            let (app, dir, client, done, bytes) = (app.clone(), dir.clone(), client.clone(), done.clone(), bytes.clone());
            async move {
                let path = inside(&dir, &file.name).ok_or_else(|| format!("bad font name {}", file.name))?;
                let body = fetch_checked(&client, &file).await?;
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|error| error.to_string())?;
                }
                let partial = path.with_extension("part");
                tokio::fs::write(&partial, &body).await.map_err(|error| error.to_string())?;
                tokio::fs::rename(&partial, &path).await.map_err(|error| error.to_string())?;
                let progress = Progress {
                    done: done.fetch_add(1, Ordering::SeqCst) + 1,
                    total,
                    bytes: bytes.fetch_add(file.size, Ordering::SeqCst) + file.size,
                    total_bytes,
                };
                let _ = app.emit("fonts-progress", progress);
                Ok::<(), String>(())
            }
        })
        .buffer_unordered(8)
        .filter_map(|result| async move { result.err() })
        .collect()
        .await;

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("{} font(s) could not be downloaded: {}", failures.len(), failures.join("; ")))
    }
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        // The page loads fonts with FontFace, a cross-origin fetch from the app's own origin.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(body)
        .unwrap_or_default()
}

/// Serves `mushaf://localhost/fonts/<name>` from the fonts folder.
pub fn protocol<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    let path = request.uri().path().to_owned();
    tauri::async_runtime::spawn(async move {
        let file = path
            .strip_prefix("/fonts/")
            .and_then(|name| fonts_dir(&app).ok().and_then(|dir| inside(&dir, name)));
        let response = match file {
            Some(file) => match tokio::fs::read(&file).await {
                Ok(body) => {
                    let kind = if path.ends_with(".ttf") { "font/ttf" } else { "font/woff2" };
                    respond(StatusCode::OK, kind, body)
                }
                Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", b"no such font".to_vec()),
            },
            None => respond(StatusCode::BAD_REQUEST, "text/plain", b"bad path".to_vec()),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, size: u64) -> FontFile {
        FontFile { name: name.into(), url: String::new(), size, sha256: String::new() }
    }

    #[test]
    fn names_cannot_leave_the_fonts_folder() {
        let dir = Path::new("/data/fonts");
        assert_eq!(inside(dir, "qcf-v2/p1.woff2"), Some(dir.join("qcf-v2/p1.woff2")));
        assert_eq!(inside(dir, "../secret"), None);
        assert_eq!(inside(dir, "/etc/passwd"), None);
        assert_eq!(inside(dir, "qcf-v2/../../x"), None);
        assert_eq!(inside(dir, ""), None);
    }

    #[test]
    fn a_font_is_missing_until_it_is_there_at_full_size() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("qcf-v2")).unwrap();
        std::fs::write(dir.path().join("qcf-v2/p1.woff2"), [0u8; 10]).unwrap();
        std::fs::write(dir.path().join("qcf-v2/p2.woff2"), [0u8; 3]).unwrap();
        let files = [file("qcf-v2/p1.woff2", 10), file("qcf-v2/p2.woff2", 10), file("qcf-v2/p3.woff2", 10)];
        let names: Vec<_> = missing(dir.path(), &files).into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["qcf-v2/p2.woff2", "qcf-v2/p3.woff2"]);
    }
}
