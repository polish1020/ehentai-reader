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
        XCTAssertTrue(app.staticTexts["1 / 1 张已下载"].waitForExistence(timeout: 60))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "completed-native-download"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
