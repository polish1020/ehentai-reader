import XCTest

final class ImportUITests: XCTestCase {
    func testImportValidationAndDuplicatePreview() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["new-download-toolbar"].tap()
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText("https://example.com/one.jpg\nhttps://example.com/two.png\nhttps://example.com/one.jpg")
        app.buttons["import-done-editing"].tap()
        XCTAssertTrue(app.staticTexts["2 张图片"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["已忽略 1 条重复链接"].exists)
        XCTAssertTrue(app.buttons["import-start"].isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "import-preview"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["取消"].tap()
        app.buttons["new-download-toolbar"].tap()
        editor.tap(); editor.typeText("file:///etc/passwd")
        app.buttons["import-done-editing"].tap()
        XCTAssertTrue(app.staticTexts["import-error"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["import-start"].isEnabled)
    }

    func testDirectHTTPSImageDownload() {
        let app = XCUIApplication(); app.launch()
        app.buttons["new-download-toolbar"].tap()
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        // An original project asset, fetched directly without cookies or a proxy.
        editor.typeText("https://raw.githubusercontent.com/polish1020/ehentai-reader/63a3203032c483cb19e308530f8fce59530e172e/apps/ImageBatch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
        app.buttons["import-done-editing"].tap()
        XCTAssertTrue(app.staticTexts["1 张图片"].waitForExistence(timeout: 5))
        app.buttons["import-start"].tap()
        if !app.staticTexts["1 / 1 张已下载"].waitForExistence(timeout: 60) {
            app.cells.firstMatch.tap()
            XCTFail("原生下载未完成：" + String(app.debugDescription.suffix(6000)))
            return
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "completed-native-download"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testSaveDirectlyToPhotosWithAddOnlyPermission() {
        let app = XCUIApplication(); app.launch()
        app.buttons["new-download-toolbar"].tap()
        let name = app.textFields["import-name"]
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + "Photos smoke")
        let editor = app.textViews["import-text"]
        editor.tap()
        editor.typeText("https://raw.githubusercontent.com/polish1020/ehentai-reader/63a3203032c483cb19e308530f8fce59530e172e/apps/ImageBatch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
        app.buttons["import-done-editing"].tap()
        app.descendants(matching: .any).matching(identifier: "save-destination").firstMatch.tap()
        app.buttons["系统相册"].tap()
        app.buttons["import-start"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        if alert.waitForExistence(timeout: 10) {
            let allow = alert.buttons.matching(NSPredicate(format: "((label CONTAINS[c] 'allow' OR label CONTAINS[c] 'add') AND NOT label CONTAINS[c] 'don') OR label BEGINSWITH '允许'")).firstMatch
            XCTAssertTrue(allow.exists); allow.tap()
        }
        XCTAssertTrue(app.staticTexts["Photos smoke"].waitForExistence(timeout: 15))
        app.staticTexts["Photos smoke"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["已存入相册"].waitForExistence(timeout: 60))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "saved-to-photos"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
