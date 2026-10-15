"""
신규 구독 부동산 추가 마법사 스크립트
소장님의 중앙 클라우드에서 실시간 매물 알림을 수신할
새로운 공인중개사사무소를 등록하고 카카오톡을 연동합니다.
"""

import os
import sys
import json
import re
import httpx
import webbrowser
from datetime import datetime

# Windows 콘솔 UTF-8 설정
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from subscribers_manager import (
    load_subscribers,
    save_subscribers,
    request_remote_license_registration,
    TOKENS_DIR,
    BASE_DIR
)
from monitor_new_articles import get_target_complexes
from kakao_auth import REST_API_KEY, REDIRECT_URI, get_authorize_url


def sanitize_id(text: str) -> str:
    """영문, 숫자, 밑줄만 남겨 안전한 ID 생성"""
    clean = re.sub(r"[^a-zA-Z0-9_]", "", text)
    return clean.lower() if clean else "user"


def issue_subscriber_token(api_key: str, auth_code: str, token_save_path: str) -> bool:
    """인가 코드로 구독자 전용 토큰 발급 및 저장"""
    url = "https://kauth.kakao.com/oauth/token"
    data = {
        "grant_type": "authorization_code",
        "client_id": api_key.strip(),
        "redirect_uri": REDIRECT_URI,
        "code": auth_code.strip()
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    try:
        res = httpx.post(url, data=data, headers=headers, timeout=15.0)
        if res.status_code == 200:
            token_info = res.json()
            token_info["rest_api_key"] = api_key.strip()
            os.makedirs(os.path.dirname(token_save_path), exist_ok=True)
            with open(token_save_path, "w", encoding="utf-8") as f:
                json.dump(token_info, f, ensure_ascii=False, indent=2)
            return True
        else:
            print(f"\n❌ [토큰 발급 실패] ({res.status_code}): {res.text}")
            return False
    except Exception as e:
        print(f"\n❌ [네트워크 오류]: {e}")
        return False


def send_pending_welcome_message(token_save_path: str, office_name: str, complex_names: list, owner_name: str = "") -> bool:
    """최초 신규 가입 접수 축하 및 승인 대기 안내 카톡 전송"""
    try:
        from kakao_notifier import KakaoTalkNotifier
        notifier = KakaoTalkNotifier(token_file=token_save_path)
        notifier.refresh_access_token()

        with open(token_save_path, "r", encoding="utf-8") as f:
            tokens = json.load(f)
        access_token = tokens.get("access_token")
        if not access_token:
            return False

        url = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        c_count = len(complex_names)
        c_summary = ", ".join(complex_names[:3]) + (f" 외 {c_count-3}개" if c_count > 3 else "")
        name_str = f"{office_name} ({owner_name} 소장님)" if owner_name and owner_name != office_name else f"{office_name} 소장님"

        msg = (
            f"🎉 [네이버 부동산 실시간 매물 알림 - 가입 신청 접수]\n\n"
            f"안녕하세요, {name_str}!\n"
            f"네이버 부동산 실시간 매물 알림 서비스 가입 신청이 성공적으로 접수되었습니다.\n\n"
            f"📋 현재 상태: [관리자 승인 대기 중]\n"
            f"🏢 신청 감시단지: 총 {c_count}개 단지 ({c_summary})\n\n"
            f"대표 관리자(태화강아이파크)의 사용 승인이 완료되는 즉시 [승인 완료 알림 카톡]과 함께 30분 주기 실시간 매물 알림이 시작됩니다.\n"
            f"승인이 완료될 때까지 잠시만 기다려 주시기 바랍니다. 감사합니다!"
        )

        template_object = {
            "object_type": "text",
            "text": msg,
            "link": {"web_url": "https://m.land.naver.com", "mobile_web_url": "https://m.land.naver.com"},
            "button_title": "네이버부동산 바로가기"
        }
        data = {"template_object": json.dumps(template_object, ensure_ascii=False)}
        res = httpx.post(url, headers=headers, data=data, timeout=10.0)
        return res.status_code == 200
    except Exception as e:
        print(f"가입 접수 안내 메시지 발송 오류: {e}")
        return False


def send_approval_complete_message(token_save_path: str, office_name: str, complex_names: list, owner_name: str = "", plan: str = "A") -> bool:
    """관리자 사용 승인 완료 및 실시간 모니터링 정식 개시 안내 카톡 전송 (파트A vs 파트B 맞춤형)"""
    try:
        from kakao_notifier import KakaoTalkNotifier
        notifier = KakaoTalkNotifier(token_file=token_save_path)
        notifier.refresh_access_token()

        with open(token_save_path, "r", encoding="utf-8") as f:
            tokens = json.load(f)
        access_token = tokens.get("access_token")
        if not access_token:
            return False

        url = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        c_count = len(complex_names)
        c_lines = "\n".join([f"  • {name}" for name in complex_names[:12]])
        if len(complex_names) > 12:
            c_lines += f"\n  ... 외 {len(complex_names)-12}개 단지"

        name_str = f"{office_name} ({owner_name} 소장님)" if owner_name and owner_name != office_name else f"{office_name} 소장님"

        if plan == "B":
            guide_part = (
                f"💻 [사무실 PC 소프트웨어 설치 안내]\n"
                f"대표님은 [파트 B : 사무실 PC 설치형]으로 승인되었습니다.\n"
                f"신청하셨던 화면 하단의 [4. 사무실 PC 설치 & 구동 센터]에서 패키지 압축파일을 다운로드받으신 후, 아래 순서대로 1회 실행해 주세요:\n"
                f"  1. 1_필수프로그램_자동설치.bat (자동 환경 구성)\n"
                f"  2. 3_30분주기_무음스케줄러_등록.bat (30분 주기 자동 실행 등록)\n\n"
                f"설치 후에는 컴퓨터가 켜져 있을 때 30분마다 무음으로 실시간 자동 감시됩니다!"
            )
        else:
            guide_part = (
                f"📱 [스마트폰 카톡형 수신 안내]\n"
                f"대표님은 PC 설치가 전혀 필요 없습니다! 대표 관리자 PC가 실시간 감시하여 위 {c_count}개 단지에 새로운 변동 매물이 포착되는 즉시 스마트폰 카톡으로 신속하게 알려드립니다."
            )

        msg = (
            f"✅ [네이버 부동산 실시간 매물 알림 - 승인 완료]\n\n"
            f"축하드립니다, {name_str}!\n"
            f"대표 관리자의 사용 승인이 최종 완료되었습니다.\n\n"
            f"🏢 수신 감시 단지 (총 {c_count}개 단지):\n"
            f"{c_lines}\n\n"
            f"⚡ 감시 주기: 30분마다 실시간 자동 감시\n"
            f"🔔 알림 항목: 신규 등록, 가격 변동, 층수 오픈, 마감/삭제\n\n"
            f"{guide_part}\n\n"
            f"소장님의 사업 번창을 진심으로 기원합니다!"
        )

        template_object = {
            "object_type": "text",
            "text": msg,
            "link": {"web_url": "https://m.land.naver.com", "mobile_web_url": "https://m.land.naver.com"},
            "button_title": "네이버부동산 바로가기"
        }
        data = {"template_object": json.dumps(template_object, ensure_ascii=False)}
        res = httpx.post(url, headers=headers, data=data, timeout=10.0)
        return res.status_code == 200
    except Exception as e:
        print(f"승인 완료 안내 메시지 발송 오류: {e}")
        return False


def send_welcome_message(token_save_path: str, office_name: str, complex_names: list, owner_name: str = "") -> bool:
    """하위 호환용 래퍼: 승인 완료 메시지 전송"""
    return send_approval_complete_message(token_save_path, office_name, complex_names, owner_name)



def main():
    print("=" * 80)
    print("🌟 [중앙 클라우드 다중 구독] 신규 부동산 등록 및 카카오톡 연동 마법사")
    print("=" * 80)
    print(" 소장님의 중앙 깃허브 클라우드에서 30분마다 크롤링한 매물 정보를")
    print(" 다른 부동산 소장님의 카카오톡으로 실시간 맞춤 전송해주는 구독자를 추가합니다.")
    print(" (상대방에게는 어떤 소스코드나 파일도 전달되지 않아 복제/유출 위험 0%)\n")

    # 1. 부동산 기본 정보 입력
    office_name = input("1. 부동산 상호명 (예: 울산드림공인중개사사무소): ").strip()
    if not office_name:
        print("❌ 상호명은 필수입니다.")
        return

    owner_name = input("2. 대표자 성명 (예: 홍길동): ").strip() or office_name
    phone = input("3. 연락처/휴대폰번호 (예: 010-1234-5678): ").strip() or "-"

    # 고유 ID 생성
    digits = re.sub(r"\D", "", phone)
    suffix = digits[-4:] if len(digits) >= 4 else "01"
    sub_id = f"realtor_{suffix}"
    print(f"   -> 구독자 고유 ID가 '{sub_id}'로 자동 설정되었습니다.")

    # 2. 수신 희망 단지 선택 (구/군별 스마트 필터)
    target_complexes = get_target_complexes()
    
    # 구/군별 단지 그룹화
    district_groups = {}
    for c in target_complexes:
        d = c.get("district", "기타/공통")
        if not d:
            d = "기타/공통"
        district_groups.setdefault(d, []).append(c)

    selected_complex_nos = []
    selected_names = []

    print("\n" + "=" * 80)
    print("🏢 [수신 희망 단지 선택 - 구/군별 간편 선택]")
    print("=" * 80)
    print(" 0. 🌟 [전체 단지 모두 수신] (현재 등록된 모든 단지)")
    
    # 울산광역시 5대 구/군 표준 순서 정렬
    ordered_keys = ["남구", "중구", "동구", "북구", "울주군"]
    d_list = [d for d in ordered_keys if d in district_groups] + [d for d in district_groups if d not in ordered_keys]

    for d_idx, d_name in enumerate(d_list, 1):
        c_count = len(district_groups[d_name])
        print(f" {d_idx}. 🏙️ [울산광역시 {d_name}] 소속 단지만 선택 (총 {c_count}개 단지)")
    print(f" {len(d_list) + 1}. 📋 [전체 단지 한눈에 보고 번호로 선택]")
    print("-" * 80)

    mode_choice = input("👉 원하시는 선택 방식 번호를 누르세요 (기본값: 0 전체): ").strip()

    if mode_choice == "0" or not mode_choice:
        selected_complex_nos = []
        selected_names = [c["name"] for c in target_complexes]
        print(f"   -> 전체 단지({len(target_complexes)}개) 알림 수신으로 설정되었습니다.")
    elif mode_choice == str(len(d_list) + 1):
        # 전체 단지 직접 번호 선택
        print("\n" + "-" * 80)
        for idx, c in enumerate(target_complexes, 1):
            d_tag = f"[{c.get('district', '')}] " if c.get('district') else ""
            print(f" {idx}. {d_tag}[{c['no']}] {c['name']}")
        print("-" * 80)
        raw_sel = input("👉 선택할 단지 번호를 쉼표로 입력하세요 (예: 1, 3): ").strip()
        tokens = [t.strip() for t in raw_sel.split(",") if t.strip()]
        for tok in tokens:
            if tok.isdigit():
                val = int(tok)
                if 1 <= val <= len(target_complexes):
                    c_obj = target_complexes[val - 1]
                    if str(c_obj["no"]) not in selected_complex_nos:
                        selected_complex_nos.append(str(c_obj["no"]))
                        selected_names.append(c_obj["name"])
    else:
        # 구/군별 선택 모드 (반복 선택 지원)
        while True:
            if mode_choice.isdigit() and 1 <= int(mode_choice) <= len(d_list):
                target_district = d_list[int(mode_choice) - 1]
                d_complexes = district_groups[target_district]

                print("\n" + "-" * 80)
                print(f"📍 [{target_district}] 소속 단지 목록:")
                print(f" A. [{target_district} 전체 단지 ({len(d_complexes)}개) 한 번에 선택]")
                for idx, c in enumerate(d_complexes, 1):
                    print(f" {idx}. [{c['no']}] {c['name']}")
                print("-" * 80)

                sub_sel = input(f"👉 [{target_district}]에서 원하는 번호를 입력하세요 (예: 1, 2 또는 전체는 A): ").strip()

                if sub_sel.upper() == "A":
                    for c in d_complexes:
                        if str(c["no"]) not in selected_complex_nos:
                            selected_complex_nos.append(str(c["no"]))
                            selected_names.append(c["name"])
                    print(f"   -> [{target_district}] 전체 단지가 추가되었습니다.")
                else:
                    tokens = [t.strip() for t in sub_sel.split(",") if t.strip()]
                    for tok in tokens:
                        if tok.isdigit():
                            val = int(tok)
                            if 1 <= val <= len(d_complexes):
                                c_obj = d_complexes[val - 1]
                                if str(c_obj["no"]) not in selected_complex_nos:
                                    selected_complex_nos.append(str(c_obj["no"]))
                                    selected_names.append(c_obj["name"])

            print(f"\n   현재까지 선택된 단지 ({len(selected_names)}개): {', '.join(selected_names) if selected_names else '없음'}")
            
            more = input("\n👉 다른 구/군의 단지도 추가로 선택하시겠습니까? (y/N): ").strip().lower()
            if more == "y":
                print("\n" + "-" * 80)
                for d_idx, d_name in enumerate(d_list, 1):
                    print(f" {d_idx}. 🏙️ [{d_name}] ({len(district_groups[d_name])}개)")
                print("-" * 80)
                mode_choice = input("👉 추가할 구/군 번호를 입력하세요: ").strip()
            else:
                break

    if not selected_complex_nos and mode_choice != "0":
        selected_complex_nos = []
        selected_names = [c["name"] for c in target_complexes]
        print(f"   -> 선택된 단지가 없어 전체 단지({len(target_complexes)}개)로 자동 설정되었습니다.")
    else:
        print(f"   ✅ 최종 선택된 단지 ({len(selected_names)}개): {', '.join(selected_names)}")

    # 3. 카카오톡 연동
    print("\n" + "=" * 80)
    print("🔑 [상대방 카카오톡 연동]")
    print("=" * 80)
    auth_url = get_authorize_url(REST_API_KEY)
    
    print(" 상대방 소장님의 스마트폰 카카오톡으로 알림을 보내려면 최초 1회 인증이 필요합니다.")
    print(" 아래 링크를 상대방에게 카톡으로 보내시거나, 지금 웹 브라우저에서 열어 로그인하세요:\n")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)

    open_now = input("\n👉 지금 이 PC 브라우저에서 인증 링크를 여시겠습니까? (Y/n): ").strip().lower()
    if open_now != "n":
        try:
            webbrowser.open(auth_url)
            print("   🌐 웹 브라우저가 열렸습니다. 카카오 로그인 후 메시지 동의를 진행해 주세요.")
        except Exception:
            pass

    print("\n [안내] 카카오 로그인 및 동의 후 화면에 '사이트에 연결할 수 없음'이 뜨며")
    print(f" 주소창이 '{REDIRECT_URI}?code=XXXXXXXXXXXXXXXXXXXXXXXX' 로 변경됩니다.")
    print(" 그 주소창의 주소 전체(또는 code 값)를 복사해서 아래에 붙여넣으세요.")

    raw_input = input("\n👉 복사한 주소(또는 code)를 여기에 붙여넣으세요: ").strip()
    if not raw_input:
        print("❌ 인증 코드가 입력되지 않아 등록을 취소합니다.")
        return

    auth_code = raw_input
    if "code=" in auth_code:
        auth_code = auth_code.split("code=")[1].split("&")[0].strip()
    auth_code = auth_code.strip("'\" \t\r\n")

    token_rel_path = f"tokens/kakao_token_{sub_id}.json"
    token_abs_path = os.path.join(BASE_DIR, token_rel_path)

    print(f"\n📡 카카오 토큰 발급 요청 중...")
    if not issue_subscriber_token(REST_API_KEY, auth_code, token_abs_path):
        print("❌ 토큰 발급에 실패했습니다. 코드가 만료되었거나 이미 사용되었습니다.")
        return

    print("🎉 [성공] 카카오 토큰 발급 완료!")

    # 4. 가입 접수 및 승인 대기 카톡 전송
    print("📱 상대방 카카오톡으로 가입 접수 & 승인 대기 메시지 전송 중...")
    welcome_ok = send_pending_welcome_message(token_abs_path, office_name, selected_names, owner_name)
    if welcome_ok:
        print("✅ [카카오톡 전송 확인] 상대방 스마트폰으로 가입 접수 & 승인 대기 안내 메시지가 전송되었습니다!")

    # 5. 구글 시트 원격 라이선스 자동 등록
    print("\n📡 구글 시트 라이선스 서버에 신규 구독자 자동 등록 중...")
    req_ok = request_remote_license_registration(
        sub_id=sub_id,
        office_name=office_name,
        owner_name=owner_name,
        phone=phone
    )
    if req_ok:
        print("✅ [구글 시트 연동] 구글 시트에 '대기중'으로 등록되었으며, 대표 소장님 카톡으로 승인 알림이 발송되었습니다!")
    else:
        print("ℹ️ 구글 시트 원격 등록 건너뜀 (로컬 관리 유지)")

    # 6. subscribers.json에 저장
    subscribers = load_subscribers()
    # 기존에 동일 ID가 있으면 갱신, 없으면 추가
    existing_idx = next((i for i, s in enumerate(subscribers) if s.get("id") == sub_id), -1)

    new_sub = {
        "id": sub_id,
        "name": office_name,
        "owner_name": owner_name,
        "phone": phone,
        "realtor_names": [office_name],
        "token_file": token_rel_path,
        "complex_nos": selected_complex_nos,
        "enabled": True,
        "license_check": True,
        "approved_notified": False,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    if existing_idx >= 0:
        subscribers[existing_idx] = new_sub
    else:
        subscribers.append(new_sub)

    save_subscribers(subscribers)

    print("\n" + "=" * 80)
    print(f"🎉 [{office_name}] 신규 구독 부동산 등록이 성공적으로 완료되었습니다!")
    print(f" • 구독 ID: {sub_id}")
    print(f" • 수신 단지: {', '.join(selected_names)}")
    print(f" • 토큰 파일: {token_rel_path}")
    print(f" • 원격 라이선스: 활성화 (구글 시트에서 승인/차단 실시간 통제 가능)")
    print("=" * 80)
    print("\n💡 [다음 단계 안내]")
    print(" 1. 구글 스프레드시트에서 해당 부동산의 '승인상태'를 [승인]으로 변경하세요.")
    print(" 2. '깃허브_업로드폴더_최신동기화.bat'를 실행하여 변경된 구독 설정을 깃허브에 반영하세요.")
    print(" 3. 이제 30분마다 소장님의 깃허브 액션즈가 상대방 카카오톡으로도 실시간 매물을 자동 전송합니다!")
    print("=" * 80)


if __name__ == "__main__":
    main()
