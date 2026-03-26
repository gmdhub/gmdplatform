// GMD Medical Platform - Tauri Backend

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

struct ApiProcessState(Mutex<Option<Child>>);

#[tauri::command]
fn convert_docx_to_pdf(docx_path: String, output_pdf_path: Option<String>) -> Result<String, String> {
    let input_path = PathBuf::from(docx_path.trim());
    if !input_path.exists() {
        return Err("Il file DOCX non esiste.".to_string());
    }

    let extension = input_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "docx" {
        return Err("Il file selezionato non è un DOCX valido.".to_string());
    }

    let out_dir = input_path
        .parent()
        .ok_or_else(|| "Impossibile risolvere la cartella di output.".to_string())?;
    let file_stem = input_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Nome file DOCX non valido.".to_string())?;
    let generated_pdf_path = out_dir.join(format!("{file_stem}.pdf"));
    let requested_output_pdf_path = output_pdf_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| generated_pdf_path.clone());

    if let Some(parent_dir) = requested_output_pdf_path.parent() {
        if !parent_dir.exists() {
            std::fs::create_dir_all(parent_dir).map_err(|error| {
                format!("Impossibile creare la cartella di output PDF richiesta: {error}")
            })?;
        }
    }

    if generated_pdf_path.exists() {
        let _ = std::fs::remove_file(&generated_pdf_path);
    }
    if generated_pdf_path != requested_output_pdf_path && requested_output_pdf_path.exists() {
        let _ = std::fs::remove_file(&requested_output_pdf_path);
    }

    let mut attempts: Vec<String> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        match convert_with_word_applescript(&input_path, &generated_pdf_path) {
            Ok(()) if generated_pdf_path.exists() => {
                return finalize_pdf_output(&generated_pdf_path, &requested_output_pdf_path)
            }
            Ok(()) => attempts.push(
                "Microsoft Word (AppleScript): conversione eseguita ma PDF non trovato".to_string(),
            ),
            Err(error) => attempts.push(format!("Microsoft Word (AppleScript): {error}")),
        }
    }

    for soffice in soffice_candidates() {
        let result = Command::new(&soffice)
            .arg("--headless")
            .arg("--nologo")
            .arg("--nolockcheck")
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(out_dir)
            .arg(&input_path)
            .output();

        match result {
            Ok(output) if output.status.success() => {
                if generated_pdf_path.exists() {
                    return finalize_pdf_output(&generated_pdf_path, &requested_output_pdf_path);
                }

                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                attempts.push(format!(
                    "{soffice}: conversione eseguita ma PDF non trovato{}",
                    if stderr.is_empty() {
                        String::new()
                    } else {
                        format!(" (stderr: {stderr})")
                    }
                ));
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                attempts.push(format!(
                    "{soffice}: exit {}{}{}",
                    output.status.code().unwrap_or(-1),
                    if stderr.is_empty() {
                        String::new()
                    } else {
                        format!(", stderr: {stderr}")
                    },
                    if stdout.is_empty() {
                        String::new()
                    } else {
                        format!(", stdout: {stdout}")
                    }
                ));
            }
            Err(error) => {
                attempts.push(format!("{soffice}: {error}"));
            }
        }
    }

    Err(format!(
        "Impossibile convertire il DOCX in PDF. Verifica LibreOffice o Microsoft Word. Dettagli: {}",
        attempts.join(" | ")
    ))
}

#[tauri::command]
fn open_file_in_word(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    if !path.exists() {
        return Err("Il file referto non esiste.".to_string());
    }

    let run = |program: &str, args: &[String]| -> Result<bool, String> {
        let status = Command::new(program)
            .args(args)
            .status()
            .map_err(|error| format!("Impossibile eseguire {program}: {error}"))?;
        Ok(status.success())
    };

    #[cfg(target_os = "macos")]
    {
        let open_with_word_args = vec![
            "-a".to_string(),
            "Microsoft Word".to_string(),
            path_to_string(&path),
        ];
        if run("open", &open_with_word_args)? {
            return Ok(());
        }

        let open_default_args = vec![path_to_string(&path)];
        if run("open", &open_default_args)? {
            return Ok(());
        }

        return Err("Impossibile aprire il referto su macOS.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let file = path_to_string(&path);

        let open_with_word_args = vec![
            "/C".to_string(),
            "start".to_string(),
            "".to_string(),
            "winword".to_string(),
            file.clone(),
        ];
        if run("cmd", &open_with_word_args)? {
            return Ok(());
        }

        let open_default_args = vec!["/C".to_string(), "start".to_string(), "".to_string(), file];
        if run("cmd", &open_default_args)? {
            return Ok(());
        }

        return Err("Impossibile aprire il referto su Windows.".to_string());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let open_default_args = vec![path_to_string(&path)];
        if run("xdg-open", &open_default_args)? {
            return Ok(());
        }

        return Err("Impossibile aprire il referto su questo sistema.".to_string());
    }
}

fn show_main_and_close_splash(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    if let Some(splash_window) = app.get_webview_window("splashscreen") {
        let _ = splash_window.close();
    }
}

fn is_local_api_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], 8787)),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn pick_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|candidate| candidate.exists()).cloned()
}

fn node_command_candidates(resource_dir: &Path) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(value) = std::env::var("GMD_NODE_PATH") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }

    candidates.push(path_to_string(
        &resource_dir
            .join("server")
            .join("dist")
            .join("runtime")
            .join("node"),
    ));
    candidates.push(path_to_string(
        &resource_dir
            .join("_up_")
            .join("server")
            .join("dist")
            .join("runtime")
            .join("node"),
    ));
    candidates.push(path_to_string(
        &resource_dir
            .join("server")
            .join("dist")
            .join("runtime")
            .join("node.exe"),
    ));
    candidates.push(path_to_string(
        &resource_dir
            .join("_up_")
            .join("server")
            .join("dist")
            .join("runtime")
            .join("node.exe"),
    ));
    candidates.push(path_to_string(&resource_dir.join("node").join("bin").join("node")));
    candidates.push("/opt/homebrew/bin/node".to_string());
    candidates.push("/usr/local/bin/node".to_string());
    candidates.push("/usr/bin/node".to_string());
    candidates.push("node".to_string());

    candidates
}

fn start_embedded_api_if_needed(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    if is_local_api_running() {
        return;
    }

    let resource_dir = match app.path().resource_dir() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Impossibile risolvere resource_dir per API embedded: {error}");
            return;
        }
    };

    let api_entry_candidates = vec![
        resource_dir.join("server").join("dist").join("index.js"),
        resource_dir.join("_up_").join("server").join("dist").join("index.js"),
        resource_dir.join("dist").join("index.js"),
        resource_dir.join("_up_").join("dist").join("index.js"),
    ];
    let api_entry = match pick_existing_path(&api_entry_candidates) {
        Some(path) => path,
        None => {
            eprintln!(
                "API embedded non trovata nel bundle. Candidati: {:?}",
                api_entry_candidates
            );
            return;
        }
    };

    let env_candidates = vec![
        api_entry.parent().map(|parent| parent.join(".env")),
        Some(resource_dir.join("server").join(".env.prod")),
        Some(resource_dir.join("_up_").join("server").join(".env.prod")),
        Some(resource_dir.join(".env.prod")),
        Some(resource_dir.join("_up_").join(".env.prod")),
    ];
    let env_file = env_candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists());

    let mut errors: Vec<String> = Vec::new();
    for node_candidate in node_command_candidates(&resource_dir) {
        let mut command = Command::new(&node_candidate);
        command
            .arg(&api_entry)
            .current_dir(api_entry.parent().unwrap_or(&resource_dir))
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(path) = &env_file {
            command.env("GMD_ENV_FILE", path);
        }

        match command.spawn() {
            Ok(child) => {
                if let Ok(mut guard) = app.state::<ApiProcessState>().0.lock() {
                    *guard = Some(child);
                }
                return;
            }
            Err(error) => {
                errors.push(format!("{node_candidate}: {error}"));
            }
        }
    }

    eprintln!(
        "Errore avvio API embedded: impossibile trovare/eseguire Node runtime. Tentativi: {}",
        errors.join(" | ")
    );
}

#[tauri::command]
fn set_app_ready(app: tauri::AppHandle) -> Result<(), String> {
    show_main_and_close_splash(&app);
    Ok(())
}

fn soffice_candidates() -> Vec<String> {
    let mut candidates = vec![
        "/Applications/LibreOffice.app/Contents/MacOS/soffice".to_string(),
        "soffice".to_string(),
        "libreoffice".to_string(),
    ];

    if cfg!(target_os = "windows") {
        candidates.insert(
            0,
            "C:\\Program Files\\LibreOffice\\program\\soffice.exe".to_string(),
        );
        candidates.insert(
            1,
            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe".to_string(),
        );
    }

    candidates
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn finalize_pdf_output(generated_pdf_path: &Path, output_pdf_path: &Path) -> Result<String, String> {
    if !generated_pdf_path.exists() {
        return Err("PDF generato non trovato.".to_string());
    }

    if generated_pdf_path != output_pdf_path {
        if output_pdf_path.exists() {
            let _ = std::fs::remove_file(output_pdf_path);
        }

        if let Some(parent_dir) = output_pdf_path.parent() {
            if !parent_dir.exists() {
                std::fs::create_dir_all(parent_dir).map_err(|error| {
                    format!("Impossibile creare la cartella per il PDF finale: {error}")
                })?;
            }
        }

        if let Err(rename_error) = std::fs::rename(generated_pdf_path, output_pdf_path) {
            std::fs::copy(generated_pdf_path, output_pdf_path).map_err(|copy_error| {
                format!(
                    "Impossibile spostare il PDF su percorso finale (rename: {rename_error}; copy: {copy_error})"
                )
            })?;
            let _ = std::fs::remove_file(generated_pdf_path);
        }
    }

    mark_file_hidden_if_supported(output_pdf_path);
    Ok(path_to_string(output_pdf_path))
}

#[cfg(target_os = "windows")]
fn mark_file_hidden_if_supported(path: &Path) {
    let _ = Command::new("attrib").arg("+h").arg(path).status();
}

#[cfg(not(target_os = "windows"))]
fn mark_file_hidden_if_supported(_path: &Path) {}

#[cfg(target_os = "macos")]
fn convert_with_word_applescript(input_path: &Path, output_pdf: &Path) -> Result<(), String> {
    let script_lines = [
        "on run argv",
        "set inputPath to item 1 of argv",
        "set outputPath to item 2 of argv",
        "tell application \"Microsoft Word\"",
        "set previousVisibility to visible",
        "set visible to false",
        "set docRef to open POSIX file inputPath",
        "save as docRef file name POSIX file outputPath file format format PDF",
        "close docRef saving no",
        "set visible to previousVisibility",
        "end tell",
        "end run",
    ];

    let mut command = Command::new("osascript");
    for line in script_lines {
        command.arg("-e").arg(line);
    }
    command
        .arg(path_to_string(input_path))
        .arg(path_to_string(output_pdf));

    let output = command
        .output()
        .map_err(|error| format!("Impossibile eseguire osascript: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "exit {}{}{}",
        output.status.code().unwrap_or(-1),
        if stderr.is_empty() {
            String::new()
        } else {
            format!(", stderr: {stderr}")
        },
        if stdout.is_empty() {
            String::new()
        } else {
            format!(", stdout: {stdout}")
        }
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ApiProcessState(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .setup(|app| {
            start_embedded_api_if_needed(&app.handle());

            let splash_window = tauri::WebviewWindowBuilder::new(
                app,
                "splashscreen",
                tauri::WebviewUrl::App("splashscreen.html".into()),
            )
            .title("Avvio GMD Medical Platform")
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .closable(false)
            .decorations(false)
            .center()
            .inner_size(560.0, 360.0)
            .always_on_top(true)
            .build();

            if let Err(error) = splash_window {
                eprintln!("Errore apertura splashscreen: {error}");
                show_main_and_close_splash(&app.handle());
            }

            let fallback_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));

                let app_handle = fallback_handle.clone();
                let _ = fallback_handle.run_on_main_thread(move || {
                    show_main_and_close_splash(&app_handle);
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            convert_docx_to_pdf,
            open_file_in_word,
            set_app_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<ApiProcessState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
