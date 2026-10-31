import XCTest

final class ImportUITests: XCTestCase {
    private let maximumImportFormScrolls = 6

    private func visibleImportForm(in app: XCUIApplication) -> XCUIElement? {
        app.collectionViews.allElementsBoundByIndex.first { collectionView in
            guard collectionView.exists else { return false }
            // SwiftUI Form containers need not be hit targets themselves. A
            // hittable import control identifies the foreground sheet instead.
            return ["import-name", "import-text", "save-destination", "import-count", "import-error", "import-manifest-toggle"].contains { identifier in
                let control = collectionView.descendants(matching: .any).matching(identifier: identifier).firstMatch
                return control.exists && control.isHittable
            }
        }
    }

    private func dragImportForm(_ form: XCUIElement, upward: Bool) {
        let start = form.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: upward ? 0.82 : 0.18))
        let end = form.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: upward ? 0.18 : 0.82))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func failWithDiagnostics(
        _ message: String,
        in app: XCUIApplication,
        attachmentPrefix: String,
        file: StaticString,
        line: UInt
    ) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(attachmentPrefix)-screenshot"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(attachmentPrefix)-accessibility-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTFail(message, file: file, line: line)
    }

    private func finishInputAndAssertImportCount(
        _ expectedText: String,
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let doneButton = app.buttons["import-done-editing"]
        guard doneButton.waitForExistence(timeout: 5) else {
            failWithDiagnostics(
                "The import keyboard toolbar did not expose the Done button.",
                in: app,
                attachmentPrefix: "import-done-missing",
                file: file,
                line: line
            )
            return
        }
        doneButton.tap()

        guard let form = visibleImportForm(in: app) else {
            failWithDiagnostics(
                "Could not identify the foreground, hittable import Form.",
                in: app,
                attachmentPrefix: "import-form-missing",
                file: file,
                line: line
            )
            return
        }

        let countLabel = app.staticTexts.matching(identifier: "import-count").firstMatch
        for attempt in 0...maximumImportFormScrolls {
            if countLabel.waitForExistence(timeout: 0.5), countLabel.isHittable {
                XCTAssertEqual(countLabel.label, expectedText, file: file, line: line)
                return
            }
            if attempt < maximumImportFormScrolls {
                dragImportForm(form, upward: false)
            }
        }

        failWithDiagnostics(
            "Did not reveal import-count with exact text \(expectedText.debugDescription) after \(maximumImportFormScrolls) bounded Form scrolls.",
            in: app,
            attachmentPrefix: "import-count-not-found",
            file: file,
            line: line
        )
    }

    private func finishInputAndAssertValidationError(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let doneButton = app.buttons["import-done-editing"]
        guard doneButton.waitForExistence(timeout: 5) else {
            failWithDiagnostics(
                "The import keyboard toolbar did not expose the Done button.",
                in: app,
                attachmentPrefix: "import-error-done-missing",
                file: file,
                line: line
            )
            return
        }
        doneButton.tap()

        guard let form = visibleImportForm(in: app) else {
            failWithDiagnostics(
                "Could not identify the foreground, hittable import Form for its validation error.",
                in: app,
                attachmentPrefix: "import-error-form-missing",
                file: file,
                line: line
            )
            return
        }

        let validationError = app.staticTexts.matching(identifier: "import-error").firstMatch
        for attempt in 0...maximumImportFormScrolls {
            if validationError.waitForExistence(timeout: 0.5), validationError.isHittable { return }
            if attempt < maximumImportFormScrolls {
                dragImportForm(form, upward: false)
            }
        }

        failWithDiagnostics(
            "Did not reveal import-error after \(maximumImportFormScrolls) bounded Form scrolls.",
            in: app,
            attachmentPrefix: "import-error-not-found",
            file: file,
            line: line
        )
    }

    private func revealSaveDestination(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement? {
        guard let form = visibleImportForm(in: app) else {
            failWithDiagnostics(
                "Could not identify the foreground, hittable import Form while returning to the save destination.",
                in: app,
                attachmentPrefix: "save-destination-form-missing",
                file: file,
                line: line
            )
            return nil
        }

        let destination = app.descendants(matching: .any).matching(identifier: "save-destination").firstMatch
        for attempt in 0...maximumImportFormScrolls {
            if destination.exists, destination.isHittable { return destination }
            if attempt < maximumImportFormScrolls {
                dragImportForm(form, upward: true)
            }
        }

        failWithDiagnostics(
            "Did not reveal save-destination after \(maximumImportFormScrolls) bounded Form scrolls.",
            in: app,
            attachmentPrefix: "save-destination-not-found",
            file: file,
            line: line
        )
        return nil
    }

    private func revealManifestToggle(
        in app: XCUIApplication,
        scrollingUpward: Bool = true,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement? {
        guard let form = visibleImportForm(in: app) else {
            failWithDiagnostics(
                "Could not identify the foreground, hittable import Form while revealing the manifest toggle.",
                in: app,
                attachmentPrefix: "manifest-toggle-form-missing",
                file: file,
                line: line
            )
            return nil
        }

        let toggle = app.buttons.matching(identifier: "import-manifest-toggle").firstMatch
        for attempt in 0...maximumImportFormScrolls {
            if toggle.exists, toggle.isHittable { return toggle }
            if attempt < maximumImportFormScrolls {
                dragImportForm(form, upward: scrollingUpward)
            }
        }

        failWithDiagnostics(
            "Did not reveal import-manifest-toggle after \(maximumImportFormScrolls) bounded Form scrolls.",
            in: app,
            attachmentPrefix: "manifest-toggle-not-found",
            file: file,
            line: line
        )
        return nil
    }

    private func revealManifestEditorIfNeeded(
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement? {
        let editor = app.textViews["import-text"]
        if editor.waitForExistence(timeout: 1), editor.isHittable { return editor }

        guard let toggle = revealManifestToggle(in: app, file: file, line: line) else { return nil }
        let state = toggle.value as? String
        if state == "已收起" {
            toggle.tap()
        } else if state != "已展开" {
            failWithDiagnostics(
                "The manifest disclosure did not expose a recognized accessibility state.",
                in: app,
                attachmentPrefix: "manifest-editor-state-mismatch",
                file: file,
                line: line
            )
            return nil
        }

        guard let form = visibleImportForm(in: app) else {
            failWithDiagnostics(
                "Could not identify the foreground, hittable import Form while revealing the manifest editor.",
                in: app,
                attachmentPrefix: "manifest-editor-form-missing",
                file: file,
                line: line
            )
            return nil
        }
        for attempt in 0...maximumImportFormScrolls {
            if editor.waitForExistence(timeout: 0.5), editor.isHittable { return editor }
            if attempt < maximumImportFormScrolls {
                dragImportForm(form, upward: true)
            }
        }

        failWithDiagnostics(
            "The manifest editor did not appear after expanding its disclosure.",
            in: app,
            attachmentPrefix: "manifest-editor-not-found",
            file: file,
            line: line
        )
        return nil
    }

    func testImportValidationAndDuplicatePreview() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["new-download-toolbar"].tap()
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText("https://example.com/one.jpg\nhttps://example.com/two.png\nhttps://example.com/one.jpg")
        finishInputAndAssertImportCount("2 张图片", in: app)
        XCTAssertTrue(app.staticTexts["已忽略 1 条重复链接"].exists)
        XCTAssertTrue(app.buttons["import-start"].isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "import-preview"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["取消"].tap()
        app.buttons["new-download-toolbar"].tap()
        editor.tap(); editor.typeText("file:///etc/passwd")
        finishInputAndAssertValidationError(in: app)
        XCTAssertTrue(app.staticTexts["import-error"].exists)
        XCTAssertFalse(app.buttons["import-start"].isEnabled)
    }

    func testLongManifestEditorCollapsesAndPreservesContent() {
        let app = XCUIApplication(); app.launch()
        let padding = String(repeating: "long-manifest-padding-", count: 160)
        let longJSON = #"{"version":1,"notes":"\#(padding)","items":[{"id":"first","url":"https://example.com/first.jpg"},{"id":"second","url":"https://example.com/second.png"}]}"#
        XCTAssertGreaterThan(longJSON.utf8.count, 3_000)

        app.buttons["new-download-toolbar"].tap()
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText(longJSON)
        finishInputAndAssertImportCount("2 张图片", in: app)
        XCTAssertFalse(editor.exists)

        let countLabel = app.staticTexts.matching(identifier: "import-count").firstMatch
        XCTAssertEqual(countLabel.label, "2 张图片")
        guard let saveDestination = revealSaveDestination(in: app) else { return }
        XCTAssertTrue(saveDestination.isHittable)

        guard let collapsedToggle = revealManifestToggle(in: app) else { return }
        XCTAssertEqual(collapsedToggle.value as? String, "已收起")
        collapsedToggle.tap()
        guard let expandedEditor = revealManifestEditorIfNeeded(in: app) else { return }
        XCTAssertEqual(expandedEditor.value as? String, longJSON)
        XCTAssertLessThanOrEqual(expandedEditor.frame.height, 210)

        guard let expandedToggle = revealManifestToggle(in: app, scrollingUpward: false) else { return }
        XCTAssertEqual(expandedToggle.value as? String, "已展开")
        expandedToggle.tap()
        XCTAssertFalse(editor.exists)

        guard let reopenedToggle = revealManifestToggle(in: app) else { return }
        reopenedToggle.tap()
        guard let reopenedEditor = revealManifestEditorIfNeeded(in: app) else { return }
        XCTAssertEqual(reopenedEditor.value as? String, longJSON)
        XCTAssertLessThanOrEqual(reopenedEditor.frame.height, 210)
    }

    func testDirectHTTPSImageDownload() {
        let app = XCUIApplication(); app.launch()
        let batchName = "Direct smoke \(UUID().uuidString)"
        app.buttons["new-download-toolbar"].tap()
        let name = app.textFields["import-name"]
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + batchName)
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        // An original project asset, fetched directly without cookies or a proxy.
        editor.typeText("https://raw.githubusercontent.com/polish1020/ehentai-reader/63a3203032c483cb19e308530f8fce59530e172e/apps/ImageBatch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
        finishInputAndAssertImportCount("1 张图片", in: app)
        app.buttons["import-start"].tap()
        let newTask = app.staticTexts[batchName].firstMatch
        XCTAssertTrue(newTask.waitForExistence(timeout: 10))
        guard newTask.exists else { return }
        newTask.tap()
        if !app.staticTexts["1 / 1 张已下载"].waitForExistence(timeout: 60) {
            XCTFail("原生下载未完成：" + String(app.debugDescription.suffix(6000)))
            return
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "completed-native-download"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testSaveDirectlyToPhotosWithAddOnlyPermission() {
        let app = XCUIApplication(); app.launch()
        let batchName = "Photos smoke \(UUID().uuidString)"
        app.buttons["new-download-toolbar"].tap()
        let name = app.textFields["import-name"]
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + batchName)
        let editor = app.textViews["import-text"]
        editor.tap()
        editor.typeText("https://raw.githubusercontent.com/polish1020/ehentai-reader/63a3203032c483cb19e308530f8fce59530e172e/apps/ImageBatch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
        finishInputAndAssertImportCount("1 张图片", in: app)
        guard let saveDestination = revealSaveDestination(in: app) else { return }
        saveDestination.tap()
        app.buttons["系统相册"].tap()
        app.buttons["import-start"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        if alert.waitForExistence(timeout: 10) {
            let allow = alert.buttons.matching(NSPredicate(format: "((label CONTAINS[c] 'allow' OR label CONTAINS[c] 'add') AND NOT label CONTAINS[c] 'don') OR label BEGINSWITH '允许'")).firstMatch
            XCTAssertTrue(allow.exists); allow.tap()
        }
        XCTAssertTrue(app.staticTexts[batchName].waitForExistence(timeout: 15))
        app.staticTexts[batchName].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["已存入相册"].waitForExistence(timeout: 60))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "saved-to-photos"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testLinkReplacementContinuesOriginalTaskAfterRelaunch() {
        let app = XCUIApplication(); app.launch()
        let asset = "https://raw.githubusercontent.com/polish1020/ehentai-reader/63a3203032c483cb19e308530f8fce59530e172e/apps/ImageBatch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
        let batchName = "Resume smoke \(UUID().uuidString)"
        app.buttons["new-download-toolbar"].tap()
        let name = app.textFields["import-name"]
        name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + batchName)
        let editor = app.textViews["import-text"]
        editor.tap(); editor.typeText(asset + "?resume=first\n" + asset + ".missing.png")
        finishInputAndAssertImportCount("2 张图片", in: app)
        app.buttons["import-start"].tap()
        XCTAssertTrue(app.staticTexts[batchName].waitForExistence(timeout: 10))
        app.staticTexts[batchName].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1 / 2 张已下载"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["· 1 张失败"].waitForExistence(timeout: 60))
        app.buttons["任务选项"].tap(); app.buttons["导入更新链接"].tap()
        guard let updateEditor = revealManifestEditorIfNeeded(in: app) else { return }
        updateEditor.tap()
        // First replacement is deliberately invalid: success requires skipping
        // the already-saved first image, not downloading the whole list again.
        updateEditor.typeText(asset + ".expired.png\n" + asset + "?resume=second")
        finishInputAndAssertImportCount("2 张图片", in: app)
        app.buttons["import-start"].tap()
        XCTAssertTrue(app.staticTexts["2 / 2 张已下载"].waitForExistence(timeout: 60))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts[batchName].waitForExistence(timeout: 10))
        app.staticTexts[batchName].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["2 / 2 张已下载"].waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "continued-after-link-update"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
