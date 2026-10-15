/**
 * [네이버 부동산 새로운 매물 알림] 구글 스프레드시트 원격 라이선스 서버 스크립트 (v2.6)
 * ★ 신규 구독자 승인 신청 및 매물단지 추가 승인 요청 시 소장님 카톡 실시간 알림 탑재 ★
 * 
 * [초간단 1분 설정 방법]
 * 1. 새 구글 스프레드시트 1개를 엽니다 (또는 기존 라이선스 시트).
 * 2. 상단 메뉴 [확장 프로그램] -> [Apps Script] 클릭
 * 3. 기존 코드를 모두 지우고 이 파일 내용을 전체 복사하여 붙여넣고 저장(Ctrl+S)합니다.
 * 4. 오른쪽 위 [배포] -> [새 배포] 클릭
 *    - 유형 선택(톱니바퀴): '웹 앱'
 *    - 설명: 라이선스 서버 v2.6 (단지승인요청 및 카톡알림)
 *    - 다음 사용자로 실행: '나(내 계정)'
 *    - 액세스 권한: '모든 사용자(Anyone)' 선택 (★필수)
 *    - [배포] 클릭 후 발급되는 '웹 앱 URL' 복사!
 * 5. 복사한 URL을 'remote_license_url.txt'에 붙여넣으면 끝!
 * 
 * ※ 카톡 테스트 방법:
 * Apps Script 상단 함수 선택에서 'testSendKakao' 선택 후 [실행] 누르면 소장님 카톡으로 즉시 테스트 메시지가 도착합니다!
 */

// =========================================================================
// [카카오톡 알림 연동 키 설정] (소장님 카카오 계정)
// =========================================================================
var KAKAO_REST_API_KEY = "1819438e56622cebb258c9ad43f8523c";
var KAKAO_REFRESH_TOKEN = "aiPTCwWgWP3OFTw0I8ZbFeHCfLOZgp-RAAAAAgoNFZsAAAGg-m2eVB7SOb8w2j0_";


function getKakaoAccessToken() {
  var props = PropertiesService.getScriptProperties();
  var cachedToken = props.getProperty("KAKAO_ACCESS_TOKEN");
  var tokenExpiry = props.getProperty("KAKAO_TOKEN_EXPIRY");
  var now = new Date().getTime();

  if (cachedToken && tokenExpiry && now < Number(tokenExpiry)) {
    return cachedToken;
  }

  // Refresh Token을 이용한 자동 Access Token 갱신
  var url = "https://kauth.kakao.com/oauth/token";
  var rToken = props.getProperty("KAKAO_REFRESH_TOKEN") || KAKAO_REFRESH_TOKEN;
  var payload = {
    "grant_type": "refresh_token",
    "client_id": KAKAO_REST_API_KEY,
    "refresh_token": rToken
  };
  var options = {
    "method": "post",
    "payload": payload,
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var data = JSON.parse(response.getContentText());
    if (data.access_token) {
      props.setProperty("KAKAO_ACCESS_TOKEN", data.access_token);
      // 유효기간 (5시간 저장)
      props.setProperty("KAKAO_TOKEN_EXPIRY", String(now + 18000 * 1000));
      if (data.refresh_token) {
        props.setProperty("KAKAO_REFRESH_TOKEN", data.refresh_token);
      }
      return data.access_token;
    }
  } catch (err) {
    Logger.log("카카오 토큰 갱신 에러: " + err);
  }
  return null;
}


function sendKakaoNotification(message, sheetUrl) {
  var accessToken = getKakaoAccessToken();
  if (!accessToken) {
    Logger.log("카카오 Access Token 획득 실패");
    return false;
  }

  var url = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
  var templateObject = {
    "object_type": "text",
    "text": message,
    "link": {
      "web_url": sheetUrl || "https://docs.google.com",
      "mobile_web_url": sheetUrl || "https://docs.google.com"
    },
    "button_title": "구글시트에서 승인하기"
  };

  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + accessToken
    },
    "payload": {
      "template_object": JSON.stringify(templateObject)
    },
    "muteHttpExceptions": true
  };

  try {
    var res = UrlFetchApp.fetch(url, options);
    return res.getResponseCode() == 200;
  } catch (err) {
    Logger.log("카카오톡 전송 실패: " + err);
    return false;
  }
}


function testSendKakao() {
  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  var msg = "🔔 [원격 라이선스 카톡 알림 연동 테스트]\n\n" +
    "구글 스프레드시트와 소장님의 카카오톡 연동이 정상 작동합니다!\n\n" +
    "🔗 [내 구글시트 바로가기]\n" +
    sheetUrl + "\n\n" +
    "앞으로 상대방이 프로그램 승인을 신청하면 즉시 카카오톡으로 알려드립니다.";
  var ok = sendKakaoNotification(msg, sheetUrl);
  Logger.log("전송 결과: " + (ok ? "성공" : "실패"));
}

// =========================================================================
// [고객 카카오톡 실시간 연동: 신청 완료 즉시 고객 본인 카톡으로 접수 환영 메시지 전송]
// =========================================================================
function issueCustomerKakaoToken(authCode) {
  if (!authCode || authCode === "관리자_카톡_간편인증_요청" || authCode.length < 5) return null;
  var tokenUrl = "https://kauth.kakao.com/oauth/token";
  var payload = {
    "grant_type": "authorization_code",
    "client_id": KAKAO_REST_API_KEY,
    "redirect_uri": "https://localhost.com",
    "code": authCode.trim()
  };
  var options = {
    "method": "post",
    "payload": payload,
    "muteHttpExceptions": true
  };
  try {
    var response = UrlFetchApp.fetch(tokenUrl, options);
    var data = JSON.parse(response.getContentText());
    if (data.access_token) {
      return data;
    }
  } catch (err) {
    Logger.log("고객 카카오 토큰 교환 에러: " + err);
  }
  return null;
}

function sendCustomerWelcomeKakao(customerAccessToken, officeName, ownerName, complexNamesStr) {
  var url = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
  var nameStr = (ownerName && ownerName !== officeName) ? (officeName + " (" + ownerName + " 소장님)") : (officeName + " 소장님");
  
  var complexList = complexNamesStr ? complexNamesStr.split(", ") : [];
  var cCount = complexList.length;
  var cSummary = (cCount > 0) ? (complexList.slice(0, 3).join(", ") + (cCount > 3 ? (" 외 " + (cCount - 3) + "개") : "")) : "지정 단지";

  var msg = "🎉 [네이버 부동산 실시간 매물 알림 - 가입 신청 접수]\n\n" +
    "안녕하세요, " + nameStr + "!\n" +
    "네이버 부동산 실시간 매물 알림 서비스 가입 신청이 성공적으로 접수되었습니다.\n\n" +
    "📋 현재 상태: [대표 관리자 승인 대기 중]\n" +
    "🏢 신청 감시단지: 총 " + (cCount > 0 ? cCount : "-") + "개 단지 (" + cSummary + ")\n\n" +
    "대표 관리자(태화강아이파크)의 사용 승인이 완료되는 즉시 [승인 완료 알림 카톡]과 함께 실시간 매물 알림이 시작됩니다.\n" +
    "승인이 완료될 때까지 잠시만 기다려 주시기 바랍니다. 감사합니다!";

  var templateObject = {
    "object_type": "text",
    "text": msg,
    "link": {
      "web_url": "https://m.land.naver.com",
      "mobile_web_url": "https://m.land.naver.com"
    },
    "button_title": "네이버부동산 바로가기"
  };

  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + customerAccessToken
    },
    "payload": {
      "template_object": JSON.stringify(templateObject)
    },
    "muteHttpExceptions": true
  };

  try {
    var res = UrlFetchApp.fetch(url, options);
    return res.getResponseCode() == 200;
  } catch (err) {
    Logger.log("고객 접수 카톡 발송 실패: " + err);
    return false;
  }
}


function doGet(e) {
  return handleRequest(e || {});
}

function doPost(e) {
  return handleRequest(e || {});
}

function handleRequest(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var params = e.parameter || {};
  if (e.postData && e.postData.contents) {
    try {
      var postJson = JSON.parse(e.postData.contents);
      for (var k in postJson) {
        if (!params[k]) params[k] = postJson[k];
      }
    } catch(err) {}
  }
  var action = params.action;
  var mid = String(params.mid || "").trim().toUpperCase();
  var user_type = params.user_type || "대표";
  var office_name = params.office_name || "미입력";
  var owner_name = params.owner_name || "미입력";
  var agent_name = params.agent_name || "-";
  var phone = params.phone || "-";
  var time = params.time || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  if (!action) {
    return ContentService.createTextOutput("NaverLand License Server v2.7 with Smart Mobile Report is Running!").setMimeType(ContentService.MimeType.TEXT);
  }

  // 1. 헤더 자동 생성 (시트가 완전히 비어있는 경우)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["신청일시", "구분", "공인중개사사무소명", "대표자명", "소속공인중개사명", "연락처", "기기번호", "승인상태", "비고"]);
    var headerRange = sheet.getRange(1, 1, 1, 9);
    headerRange.setBackground("#343a40").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  }

  var data = sheet.getDataRange().getValues();
  var header = data[0] || [];

  // 열 인덱스 스마트 자동 감지
  var midCol = 6;     // 기본 G열 (0-based: 6)
  var statusCol = 7;  // 기본 H열 (0-based: 7)

  for (var c = 0; c < header.length; c++) {
    var hText = String(header[c]).trim();
    if (hText.indexOf("기기") !== -1 || hText.indexOf("MID") !== -1 || hText.indexOf("기기번호") !== -1) {
      midCol = c;
    }
    if (hText.indexOf("상태") !== -1 || hText.indexOf("승인상태") !== -1) {
      statusCol = c;
    }
  }

  // =========================================================================
  // 1. 신규 사용자의 승인 요청 (프로그램 최초 실행 시 자동 호출)
  // =========================================================================
  if (action === "request") {
    if (!mid) {
      return ContentService.createTextOutput(JSON.stringify({result: "ERROR", message: "Missing mid"})).setMimeType(ContentService.MimeType.JSON);
    }

    var auth_code = String(params.auth_code || "").trim();
    var customerTokenInfo = issueCustomerKakaoToken(auth_code);
    var customerKakaoSent = false;
    var customerTokenNote = "";

    if (customerTokenInfo && customerTokenInfo.access_token) {
      customerKakaoSent = sendCustomerWelcomeKakao(customerTokenInfo.access_token, office_name, owner_name, params.req_complexes || params.requested_complexes || "");
      if (customerTokenInfo.refresh_token) {
        customerTokenNote = " [카톡토큰보유 RT:" + customerTokenInfo.refresh_token + "]";
      }
    }

    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][midCol]).trim().toUpperCase() === mid) {
        rowIndex = i + 1; // 1-based row index
        break;
      }
    }

    var req_complexes = params.req_complexes || params.requested_complexes || "";
    var kakaoStatusStr = customerKakaoSent ? " [고객카톡접수완료]" : (auth_code && auth_code !== "관리자_카톡_간편인증_요청" ? " [인증코드접수]" : " [모바일간편요청]");
    var memoNote = req_complexes ? ("신규 승인 신청 (요청단지: " + req_complexes + ")" + kakaoStatusStr + customerTokenNote) : ("신규 승인 신청" + kakaoStatusStr + customerTokenNote);

    var isNew = (rowIndex === -1);
    if (isNew) {
      // 신규 기기 등록 (기본 상태: 대기중)
      var newRow = [time, user_type, office_name, owner_name, agent_name, phone, mid, "대기중", memoNote];
      sheet.appendRow(newRow);
    } else {
      // 기존 기기 정보 업데이트 (상태는 보존)
      sheet.getRange(rowIndex, 1).setValue(time);
      sheet.getRange(rowIndex, 2).setValue(user_type);
      sheet.getRange(rowIndex, 3).setValue(office_name);
      sheet.getRange(rowIndex, 4).setValue(owner_name);
      sheet.getRange(rowIndex, 5).setValue(agent_name);
      sheet.getRange(rowIndex, 6).setValue(phone);
      if (req_complexes || memoNote) {
        sheet.getRange(rowIndex, 9).setValue(memoNote);
      }
    }

    // 신규 추가 요청 단지가 있는 경우 '단지추가요청' 시트에도 자동 누적 기록! (문수로트럼프/대표 제외)
    var isTrumpOrOwner = (office_name.indexOf("문수로트럼프") !== -1) || (mid === "SUB_01073688338") || (office_name.indexOf("태화강아이파크") !== -1);
    if (req_complexes && !isTrumpOrOwner) {
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var complexSheet = ss.getSheetByName("단지추가요청");
        if (!complexSheet) {
          complexSheet = ss.insertSheet("단지추가요청");
        }
        if (complexSheet.getLastRow() === 0) {
          complexSheet.appendRow(["요청일시", "공인중개사사무소명", "신청자명", "연락처", "요청단지명/링크", "추출단지번호", "처리상태", "요청메모"]);
          var cHeaderRange = complexSheet.getRange(1, 1, 1, 8);
          cHeaderRange.setBackground("#0284c7").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
        }
        complexSheet.appendRow([time, office_name, owner_name, phone, req_complexes, "-", "대기중", "구독 신청 시 동시 요청" + kakaoStatusStr]);
      } catch (ce) {
        Logger.log("단지추가요청 시트 기록 예외: " + ce);
      }
    }

    // ★ [소장님 카카오톡 즉시 알림 발송!] ★
    try {
      var agentLine = (user_type === "소속공인중개사") ? ("\n• 👤 소속공인: " + agent_name) : "";
      var complexLine = req_complexes ? ("\n• ✨ 신규 추가 요청 단지:\n  " + req_complexes.split(", ").join("\n  ")) : "";
      var customerKakaoNotice = customerKakaoSent 
        ? "\n• 💬 고객 카톡: 가입 접수 환영 카톡 발송 완료! ✅"
        : (auth_code && auth_code !== "관리자_카톡_간편인증_요청" 
            ? "\n• 💬 고객 카톡: 인증코드 접수됨 (승인 시 토큰 발급)" 
            : "\n• 💬 고객 카톡: 모바일 간편신청 (소장님이 카톡 간편안내 필요)");

      var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
      var kakaoMsg = "🔔 [신규 구독 신청 & 승인 요청 알림]\n\n" +
        "새로운 부동산에서 프로그램 사용 승인을 신청했습니다!\n\n" +
        "🏢 중개업소: " + office_name + "\n" +
        "🏷️ 구분: " + user_type + "\n" +
        "👤 대표자: " + owner_name + agentLine + "\n" +
        "📱 연락처: " + phone + "\n" +
        "🆔 기기번호: " + mid + complexLine + customerKakaoNotice + "\n" +
        "⏰ 신청일시: " + time + "\n\n" +
        "🔗 [구글시트 바로가기]\n" +
        sheetUrl + "\n\n" +
        "💡 위 파란색 구글시트 링크를 누르신 후 '승인상태' 칸을 [승인]으로 변경해 주시면 즉시 작동합니다.";

      sendKakaoNotification(kakaoMsg, sheetUrl);
    } catch (e) {
      Logger.log("소장님 카톡 발송 예외: " + e);
    }

    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      status: "PENDING",
      is_new: isNew,
      customer_kakao_sent: customerKakaoSent
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 2. 프로그램 실행 시 승인 상태 확인 (매 실행 시마다 검증)
  // =========================================================================
  if (action === "check") {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][midCol]).trim().toUpperCase() === mid) {
        var status = String(data[i][statusCol]).trim();
        if (status === "승인" || status === "ACTIVE" || status === "사용중") {
          return ContentService.createTextOutput(JSON.stringify({mid: mid, status: "ACTIVE"})).setMimeType(ContentService.MimeType.JSON);
        } else if (status === "차단" || status === "BLOCKED" || status === "정지") {
          return ContentService.createTextOutput(JSON.stringify({mid: mid, status: "BLOCKED"})).setMimeType(ContentService.MimeType.JSON);
        } else {
          return ContentService.createTextOutput(JSON.stringify({mid: mid, status: "PENDING"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({mid: mid, status: "NOT_FOUND"})).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 3. 신규 매물단지 추가 승인 요청 (고객 화면에서 신청 시 소장님 카톡 즉시 알림)
  // =========================================================================
  if (action === "request_complex") {

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var complexSheet = ss.getSheetByName("단지추가요청");

    if (!complexSheet) {
      complexSheet = ss.insertSheet("단지추가요청");
    }

    if (complexSheet.getLastRow() === 0) {
      complexSheet.appendRow(["요청일시", "공인중개사사무소명", "신청자명", "연락처", "요청단지명/링크", "추출단지번호", "처리상태", "요청메모"]);
      var cHeaderRange = complexSheet.getRange(1, 1, 1, 8);
      cHeaderRange.setBackground("#0284c7").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    }

    var complex_name = params.complex_name || "미입력";
    var complex_no = params.complex_no || "-";
    var memo = params.memo || "-";

    var newComplexRow = [time, office_name, owner_name, phone, complex_name, complex_no, "대기중", memo];
    complexSheet.appendRow(newComplexRow);

    // ★ [소장님 카카오톡 즉시 알림 발송!] ★
    try {
      var sheetUrl = ss.getUrl();
      var cnoText = (complex_no && complex_no !== "-") ? ("\n• 🔢 단지번호: " + complex_no) : "";
      var memoText = (memo && memo !== "-") ? ("\n• 📝 요청내용: " + memo) : "";
      var kakaoMsg = "🔔 [네이버부동산 매물단지 추가 승인 요청 알림]\n\n" +
        "새로운 매물단지 추가 승인 요청이 접수되었습니다!\n\n" +
        "🏢 중개업소: " + office_name + "\n" +
        "👤 신청자: " + owner_name + "\n" +
        "📱 연락처: " + phone + "\n" +
        "📍 요청단지: " + complex_name + cnoText + memoText + "\n" +
        "⏰ 요청일시: " + time + "\n\n" +
        "🔗 [구글시트 바로가기]\n" +
        sheetUrl + "\n\n" +
        "💡 관리자 관제센터에서 단지 번호/링크를 검증 후 등록하시면 중앙 깃허브 클라우드에 30분 주기로 반영됩니다.";

      sendKakaoNotification(kakaoMsg, sheetUrl);
    } catch (e) {
      Logger.log("단지추가 카톡 발송 예외: " + e);
    }

    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      status: "PENDING",
      message: "단지 추가 승인 요청이 성공적으로 접수되었습니다. 관리자 확인 후 공식 목록에 등록됩니다."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 4. 타 부동산 대거 추가 등록 리포트 저장 (save_competing_report)
  // =========================================================================
  if (action === "save_competing_report") {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reportSheet = ss.getSheetByName("타부동산리포트");
    if (!reportSheet) {
      reportSheet = ss.insertSheet("타부동산리포트");
    }

    if (reportSheet.getLastRow() === 0) {
      reportSheet.appendRow(["기록일시", "리포트ID", "단지번호", "단지명", "세대정보", "자사가격", "자사중개사", "추가부동산수", "경쟁매물JSON"]);
      var rHeaderRange = reportSheet.getRange(1, 1, 1, 9);
      rHeaderRange.setBackground("#1e293b").setFontColor("#38bdf8").setFontWeight("bold").setHorizontalAlignment("center");
    }

    var report_id = params.report_id || ("rpt_" + new Date().getTime());
    var complex_no = params.complex_no || "";
    var complex_name = params.complex_name || "";
    var unit_desc = params.unit_desc || "";
    var my_price = params.my_price || "";
    var my_realtor = params.my_realtor || "태화강아이파크공인중개사사무소";
    var comp_count = Number(params.comp_count || 0);
    var competitors_json = (typeof params.competitors === "string") ? params.competitors : JSON.stringify(params.competitors || []);

    reportSheet.appendRow([time, report_id, complex_no, complex_name, unit_desc, my_price, my_realtor, comp_count, competitors_json]);

    var scriptUrl = ScriptApp.getService().getUrl();
    var viewUrl = scriptUrl + "?action=view_competing&id=" + encodeURIComponent(report_id);

    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      report_id: report_id,
      view_url: viewUrl
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 5. 타 부동산 대거 추가 등록 스마트폰 전용 웹 리포트 뷰어 (view_competing)
  // =========================================================================
  if (action === "view_competing") {
    var report_id = params.id || "";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reportSheet = ss.getSheetByName("타부동산리포트");

    var reportData = null;

    if (reportSheet && report_id) {
      var rData = reportSheet.getDataRange().getValues();
      for (var i = rData.length - 1; i >= 1; i--) { // 최신순 탐색
        if (String(rData[i][1]).trim() === String(report_id).trim()) {
          var compListParsed = [];
          try {
            compListParsed = JSON.parse(rData[i][8] || "[]");
          } catch(e) {}

          reportData = {
            time: rData[i][0],
            report_id: rData[i][1],
            complex_no: rData[i][2],
            complex_name: rData[i][3],
            unit_desc: rData[i][4],
            my_price: rData[i][5],
            my_realtor: rData[i][6],
            comp_count: rData[i][7],
            competitors: compListParsed
          };
          break;
        }
      }
    }

    // 만약 시트에서 못 찾았더라도 URL에 direct_data 파라미터가 있으면 즉시 파싱!
    if (!reportData && params.direct_data) {
      try {
        reportData = JSON.parse(decodeURIComponent(params.direct_data));
      } catch (e) {}
    }

    if (!reportData) {
      var notFoundHtml = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1.0'>" +
        "<title>리포트를 찾을 수 없음</title></head><body style='background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding:50px 20px;'>" +
        "<h2>⚠️ 리포트를 찾을 수 없습니다</h2><p style='color:#94a3b8;margin-top:10px;'>해당 알림의 매물 데이터가 만료되었거나 존재하지 않습니다.</p>" +
        "<a href='https://m.land.naver.com' style='display:inline-block;margin-top:20px;padding:12px 24px;background:#03c75a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;'>네이버 부동산으로 이동</a>" +
        "</body></html>";
      return HtmlService.createHtmlOutput(notFoundHtml).setTitle("리포트 없음").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    var htmlOutput = renderCompetingReportHtml(reportData);
    return HtmlService.createHtmlOutput(htmlOutput)
      .setTitle("🚨 " + (reportData.complex_name || "단지") + " 타부동산 추가 등록 명단")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================================================================
  // 6. 등록 구독자 전체 목록 실시간 조회 (list) - 관리자 화면과 구글 시트 실시간 동기화
  // =========================================================================
  if (action === "list") {
    var subs = [];
    for (var i = 1; i < data.length; i++) {
      var rTime = String(data[i][0] || "").trim();
      var rUserType = String(data[i][1] || "대표").trim();
      var rOffice = String(data[i][2] || "").trim();
      var rOwner = String(data[i][3] || "").trim();
      var rAgent = String(data[i][4] || "-").trim();
      var rPhone = String(data[i][5] || "").trim();
      var rMid = String(data[i][midCol] || "").trim().toUpperCase();
      var rStatus = String(data[i][statusCol] || "대기중").trim();
      var rMemo = String(data[i][8] || "").trim();

      // 상호명과 mid 둘 다 없는 빈 행은 스킵
      if (!rOffice && !rMid) continue;

      subs.push({
        time: rTime,
        user_type: rUserType,
        office_name: rOffice,
        owner_name: rOwner,
        agent_name: rAgent,
        phone: rPhone,
        mid: rMid,
        status: rStatus,
        memo: rMemo
      });
    }

    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      count: subs.length,
      subscribers: subs
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 7. 구독 부동산 삭제 (관리자 관제센터에서 삭제 시 구글 시트 해당 1개 행만 정확히 안전 삭제)
  // =========================================================================
  if (action === "delete") {
    var targetMid = String(params.mid || "").trim().toUpperCase();
    var targetPhone = String(params.phone || "").replace(/[^0-9]/g, "");
    var targetOffice = String(params.office_name || "").trim();

    var deletedCount = 0;
    var deletedOffice = "";

    // 식별자가 유효한 경우에만 안전하게 삭제 수행 (공백이나 빈 값으로 인한 무차별 삭제 절대 방지)
    var hasValidId = (targetMid.length >= 4) || (targetPhone.length >= 8) || (targetOffice.length >= 2);

    if (hasValidId) {
      // 역순으로 탐색하여 정확히 일치하는 단 1개 행만 삭제하고 즉시 break!
      for (var i = data.length - 1; i >= 1; i--) {
        var rowMid = String(data[i][midCol] || "").trim().toUpperCase();
        var rowPhone = String(data[i][5] || "").replace(/[^0-9]/g, ""); // F열 연락처
        var rowOffice = String(data[i][2] || "").trim();               // C열 상호명

        // ★ [영구 보호 잠금장치] 기본 정식 구독자 및 대표 계정은 어떤 삭제 명령이 오더라도 절대 삭제 불가!
        if (rowMid === "SUB_01073688338" || rowPhone === "01073688338" || rowOffice.indexOf("문수로트럼프") !== -1 || rowOffice.indexOf("태화강아이파크") !== -1) {
          continue; // 절대 삭제하지 않고 건너뜀
        }

        var match = false;
        // 1순위: 기기번호(mid)가 존재하고 100% 엄격 일치 (Strict Exact Match)
        if (targetMid && rowMid && targetMid.length >= 4 && rowMid === targetMid) {
          match = true;
        }
        // 2순위: 연락처가 8자리 이상 존재하고 100% 엄격 일치
        else if (targetPhone && rowPhone && targetPhone.length >= 8 && rowPhone === targetPhone) {
          match = true;
        }
        // 3순위: 상호명이 2글자 이상 존재하고 100% 엄격 일치
        else if (targetOffice && rowOffice && targetOffice.length >= 2 && rowOffice === targetOffice) {
          match = true;
        }

        if (match) {
          deletedOffice = rowOffice || targetOffice;
          sheet.deleteRow(i + 1); // 1-based row index
          deletedCount = 1;
          break; // ★ 절대 다른 행을 건드리지 않고 정확히 1개 행 삭제 후 즉시 루프 탈출!
        }
      }
      // 2. '단지추가요청' 시트에서도 해당 부동산의 요청 행 자동 동시 삭제!
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var complexSheet = ss.getSheetByName("단지추가요청");
        if (complexSheet && complexSheet.getLastRow() > 1) {
          var cData = complexSheet.getDataRange().getValues();
          var midDigits = targetMid.replace(/[^0-9]/g, ""); // 예: SUB_555 -> 555

          for (var j = cData.length - 1; j >= 1; j--) {
            var cOffice = String(cData[j][1] || "").trim(); // B열 상호명
            var cPhone = String(cData[j][3] || "").replace(/[^0-9]/g, ""); // D열 연락처

            var cMatch = false;
            // 1) 기기번호에서 추출한 숫자와 연락처가 일치하는 경우 (예: SUB_555 -> 555 == 555)
            if (midDigits && cPhone && midDigits.length >= 3 && midDigits === cPhone) {
              cMatch = true;
            }
            // 2) 연락처가 일치하는 경우 (3자리 이상 테스트 번호 555 등 완벽 지원)
            else if (targetPhone && cPhone && targetPhone.length >= 3 && targetPhone === cPhone) {
              cMatch = true;
            }
            // 3) 상호명이 일치하거나 포함되는 경우 (예: 5555)
            else if (targetOffice && cOffice && targetOffice.length >= 2 && (cOffice === targetOffice || cOffice.indexOf(targetOffice) !== -1 || targetOffice.indexOf(cOffice) !== -1)) {
              cMatch = true;
            }

            if (cMatch) {
              complexSheet.deleteRow(j + 1);
            }
          }
        }
      } catch (errComplex) {
        Logger.log("단지추가요청 시트 삭제 예외: " + errComplex);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      action: "delete",
      deleted_count: deletedCount,
      office: deletedOffice,
      mid: targetMid
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 8. '단지추가요청' 시트 전용 특정 행 삭제 (delete_complex_req)
  // =========================================================================
  if (action === "delete_complex_req") {
    var targetOffice = String(params.office_name || "").trim();
    var targetPhone = String(params.phone || "").replace(/[^0-9]/g, "");
    var cDeleted = 0;
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var complexSheet = ss.getSheetByName("단지추가요청");
      if (complexSheet && complexSheet.getLastRow() > 1) {
        var cData = complexSheet.getDataRange().getValues();
        for (var j = cData.length - 1; j >= 1; j--) {
          var cOffice = String(cData[j][1] || "").trim();
          var cPhone = String(cData[j][3] || "").replace(/[^0-9]/g, "");
          if ((targetPhone && cPhone && cPhone === targetPhone) ||
              (targetOffice && cOffice && (cOffice === targetOffice || cOffice.indexOf(targetOffice) !== -1))) {
            complexSheet.deleteRow(j + 1);
            cDeleted++;
          }
        }
      }
    } catch (e) {}
    return ContentService.createTextOutput(JSON.stringify({
      result: "OK",
      action: "delete_complex_req",
      deleted_count: cDeleted
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // =========================================================================
  // 8. 구독 부동산 승인 상태 원격 변경 (approve / update_status)
  // =========================================================================
  if (action === "approve" || action === "update_status") {
    var targetMid = String(params.mid || "").trim().toUpperCase();
    var targetPhone = String(params.phone || "").replace(/[^0-9]/g, "");
    var targetOffice = String(params.office_name || "").trim();
    var newStatus = params.new_status || params.status || "승인";

    var updated = false;
    for (var i = 1; i < data.length; i++) {
      var rowMid = String(data[i][midCol] || "").trim().toUpperCase();
      var rowPhone = String(data[i][5] || "").replace(/[^0-9]/g, "");
      var rowOffice = String(data[i][2] || "").trim();

      if ((targetMid && rowMid && rowMid === targetMid) ||
          (targetPhone && rowPhone && rowPhone === targetPhone) ||
          (targetOffice && rowOffice && rowOffice === targetOffice)) {
        sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
        updated = true;
        break;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      result: updated ? "OK" : "NOT_FOUND",
      status: newStatus
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({result: "UNKNOWN_ACTION"})).setMimeType(ContentService.MimeType.JSON);
}


/**
 * [스마트폰 최적화] 타 부동산 추가 등록 리포트 반응형 HTML 생성 함수
 */
function renderCompetingReportHtml(r) {
  var cName = r.complex_name || "단지";
  var uDesc = r.unit_desc || "";
  var myPrc = r.my_price || "-";
  var myR = r.my_realtor || "태화강아이파크공인중개사사무소";
  var cNo = r.complex_no || "";
  var compList = r.competitors || [];
  var totalComp = compList.length;
  var complexUrl = cNo ? ("https://m.land.naver.com/complex/info/" + cNo) : "https://m.land.naver.com";
  var recordTime = r.time || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  var cardsHtml = "";
  for (var i = 0; i < compList.length; i++) {
    var c = compList[i];
    var rName = c.realtorName || "공인중개사";
    var prc = c.dealOrWarrantPrc || "";
    var rent = c.rentPrc ? (" / 월 " + c.rentPrc + "만") : "";
    var tType = c.tradeTypeName || "";
    var desc = c.articleFeatureDesc || "매물 특징 정보 없음";
    var artNo = c.articleNo || "";
    var artUrl = artNo ? ("https://m.land.naver.com/article/info/" + artNo) : complexUrl;

    cardsHtml += '<div class="realtor-card">' +
      '<div class="card-top">' +
        '<div class="realtor-badge-wrap">' +
          '<span class="idx-badge">#' + (i + 1) + '</span>' +
          '<span class="realtor-name">' + rName + '</span>' +
        '</div>' +
        '<div class="price-val">' + (tType ? tType + " " : "") + prc + rent + '</div>' +
      '</div>' +
      '<div class="card-desc">📝 ' + desc + '</div>' +
      '<div class="card-actions">' +
        '<a href="' + artUrl + '" target="_blank" class="btn-naver-link">🔗 네이버 매물 상세 보기</a>' +
      '</div>' +
    '</div>';
  }

  var html = '<!DOCTYPE html>' +
  '<html lang="ko">' +
  '<head>' +
  '  <meta charset="UTF-8">' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">' +
  '  <title>🚨 ' + cName + ' 타부동산 추가 등록 명단</title>' +
  '  <link rel="preconnect" href="https://fonts.googleapis.com">' +
  '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
  '  <style>' +
  '    * { box-sizing: border-box; margin: 0; padding: 0; }' +
  '    body {' +
  '      font-family: "Noto Sans KR", -apple-system, BlinkMacSystemFont, sans-serif;' +
  '      background: #0f172a;' +
  '      color: #f8fafc;' +
  '      line-height: 1.5;' +
  '      padding-bottom: 50px;' +
  '      -webkit-font-smoothing: antialiased;' +
  '    }' +
  '    .header-bar {' +
  '      background: rgba(15, 23, 42, 0.95);' +
  '      backdrop-filter: blur(10px);' +
  '      position: sticky;' +
  '      top: 0;' +
  '      z-index: 50;' +
  '      padding: 14px 18px;' +
  '      border-bottom: 1px solid #334155;' +
  '      display: flex;' +
  '      justify-content: space-between;' +
  '      align-items: center;' +
  '    }' +
  '    .header-logo {' +
  '      font-size: 16px;' +
  '      font-weight: 700;' +
  '      color: #38bdf8;' +
  '      display: flex;' +
  '      align-items: center;' +
  '      gap: 6px;' +
  '    }' +
  '    .header-badge {' +
  '      background: #ef4444;' +
  '      color: #fff;' +
  '      font-size: 11px;' +
  '      font-weight: 700;' +
  '      padding: 3px 8px;' +
  '      border-radius: 9999px;' +
  '    }' +
  '    .container {' +
  '      max-width: 600px;' +
  '      margin: 0 auto;' +
  '      padding: 16px;' +
  '    }' +
  '    .hero-box {' +
  '      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);' +
  '      border: 1px solid #38bdf8;' +
  '      border-radius: 16px;' +
  '      padding: 20px;' +
  '      margin-top: 8px;' +
  '      box-shadow: 0 10px 25px -5px rgba(56, 189, 248, 0.15);' +
  '    }' +
  '    .complex-name {' +
  '      font-size: 22px;' +
  '      font-weight: 800;' +
  '      color: #ffffff;' +
  '      margin-bottom: 4px;' +
  '    }' +
  '    .unit-info {' +
  '      font-size: 14px;' +
  '      color: #94a3b8;' +
  '      margin-bottom: 16px;' +
  '    }' +
  '    .my-box {' +
  '      background: rgba(16, 185, 129, 0.1);' +
  '      border: 1px solid rgba(16, 185, 129, 0.3);' +
  '      border-radius: 10px;' +
  '      padding: 12px 14px;' +
  '      display: flex;' +
  '      justify-content: space-between;' +
  '      align-items: center;' +
  '    }' +
  '    .my-box .label {' +
  '      font-size: 12px;' +
  '      color: #34d399;' +
  '      font-weight: 600;' +
  '    }' +
  '    .my-box .val {' +
  '      font-size: 16px;' +
  '      color: #10b981;' +
  '      font-weight: 800;' +
  '    }' +
  '    .section-header {' +
  '      display: flex;' +
  '      justify-content: space-between;' +
  '      align-items: center;' +
  '      margin: 24px 4px 12px 4px;' +
  '    }' +
  '    .section-title {' +
  '      font-size: 16px;' +
  '      font-weight: 700;' +
  '      color: #f1f5f9;' +
  '    }' +
  '    .count-pill {' +
  '      background: #f43f5e;' +
  '      color: #fff;' +
  '      font-size: 12px;' +
  '      font-weight: 700;' +
  '      padding: 3px 10px;' +
  '      border-radius: 9999px;' +
  '    }' +
  '    .cards-wrapper {' +
  '      display: flex;' +
  '      flex-direction: column;' +
  '      gap: 10px;' +
  '    }' +
  '    .realtor-card {' +
  '      background: #1e293b;' +
  '      border: 1px solid #334155;' +
  '      border-radius: 12px;' +
  '      padding: 14px 16px;' +
  '      display: flex;' +
  '      flex-direction: column;' +
  '      gap: 10px;' +
  '      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);' +
  '    }' +
  '    .card-top {' +
  '      display: flex;' +
  '      justify-content: space-between;' +
  '      align-items: center;' +
  '    }' +
  '    .realtor-badge-wrap {' +
  '      display: flex;' +
  '      align-items: center;' +
  '      gap: 8px;' +
  '    }' +
  '    .idx-badge {' +
  '      background: #334155;' +
  '      color: #94a3b8;' +
  '      font-size: 11px;' +
  '      font-weight: 700;' +
  '      padding: 2px 6px;' +
  '      border-radius: 6px;' +
  '    }' +
  '    .realtor-name {' +
  '      font-size: 15px;' +
  '      font-weight: 700;' +
  '      color: #f8fafc;' +
  '    }' +
  '    .price-val {' +
  '      font-size: 16px;' +
  '      font-weight: 800;' +
  '      color: #38bdf8;' +
  '      white-space: nowrap;' +
  '    }' +
  '    .card-desc {' +
  '      font-size: 13px;' +
  '      color: #94a3b8;' +
  '      background: #0f172a;' +
  '      padding: 8px 12px;' +
  '      border-radius: 8px;' +
  '      border: 1px solid #1e293b;' +
  '    }' +
  '    .card-actions {' +
  '      display: flex;' +
  '      justify-content: flex-end;' +
  '    }' +
  '    .btn-naver-link {' +
  '      display: inline-flex;' +
  '      align-items: center;' +
  '      gap: 4px;' +
  '      font-size: 12px;' +
  '      font-weight: 600;' +
  '      color: #03c75a;' +
  '      background: rgba(3, 199, 90, 0.1);' +
  '      border: 1px solid rgba(3, 199, 90, 0.3);' +
  '      padding: 6px 12px;' +
  '      border-radius: 6px;' +
  '      text-decoration: none;' +
  '    }' +
  '    .btn-complex-all {' +
  '      display: block;' +
  '      text-align: center;' +
  '      background: #03c75a;' +
  '      color: #ffffff;' +
  '      font-size: 15px;' +
  '      font-weight: 700;' +
  '      padding: 15px;' +
  '      border-radius: 12px;' +
  '      text-decoration: none;' +
  '      margin-top: 24px;' +
  '      box-shadow: 0 4px 15px rgba(3, 199, 90, 0.3);' +
  '    }' +
  '    .timestamp {' +
  '      text-align: center;' +
  '      font-size: 11px;' +
  '      color: #64748b;' +
  '      margin-top: 16px;' +
  '    }' +
  '  </style>' +
  '</head>' +
  '<body>' +
  '  <div class="header-bar">' +
  '    <div class="header-logo">🏢 태화강아이파크 관제센터</div>' +
  '    <div class="header-badge">실시간 침범 알림</div>' +
  '  </div>' +
  '  <div class="container">' +
  '    <div class="hero-box">' +
  '      <div class="complex-name">' + cName + '</div>' +
  '      <div class="unit-info">📍 ' + uDesc + '</div>' +
  '      <div class="my-box">' +
  '        <span class="label">👑 자사 등록가 (' + myR + ')</span>' +
  '        <span class="val">' + myPrc + '</span>' +
  '      </div>' +
  '    </div>' +
  '    <div class="section-header">' +
  '      <div class="section-title">🚨 새로 추가된 타 부동산 명단</div>' +
  '      <div class="count-pill">총 ' + totalComp + '곳 등록</div>' +
  '    </div>' +
  '    <div class="cards-wrapper">' + cardsHtml + '</div>' +
  '    <a href="' + complexUrl + '" target="_blank" class="btn-complex-all">🏢 네이버 부동산 단지 페이지 바로가기</a>' +
  '    <div class="timestamp">수집일시: ' + recordTime + '</div>' +
  '  </div>' +
  '</body>' +
  '</html>';

  return html;
}


