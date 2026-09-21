from app.services.client_ip import client_ip_from_forwarded, is_unusable_client_ip


def test_skips_nginx_appended_cloudfront_hop() -> None:
    assert (
        client_ip_from_forwarded(
            peer_host="172.18.0.4",
            x_forwarded_for="8.8.8.8, 13.32.1.1",
        )
        == "8.8.8.8"
    )


def test_ignores_spoofed_prefix_when_nginx_appended_edge() -> None:
    assert (
        client_ip_from_forwarded(
            peer_host="172.18.0.4",
            x_forwarded_for="1.1.1.1, 8.8.8.8, 13.32.1.1",
        )
        == "8.8.8.8"
    )


def test_does_not_trust_xff_from_public_peer() -> None:
    assert (
        client_ip_from_forwarded(
            peer_host="8.8.4.4",
            x_forwarded_for="1.1.1.1",
        )
        == "8.8.4.4"
    )


def test_single_public_hop_behind_private_peer() -> None:
    assert (
        client_ip_from_forwarded(
            peer_host="192.168.1.2",
            x_forwarded_for="8.8.8.8",
        )
        == "8.8.8.8"
    )


def test_loopback_and_docker_are_unusable() -> None:
    assert is_unusable_client_ip("127.0.0.1")
    assert is_unusable_client_ip("172.18.0.4")
    assert not is_unusable_client_ip("8.8.8.8")
