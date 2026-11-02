<?php

namespace ErnestDefoe\Sheaf\Tests\integration\api;

use Flarum\Testing\integration\TestCase;
use PHPUnit\Framework\Attributes\Test;

class ForumAttributesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('ernestdefoe-sheaf');
    }

    private function maxQuotes(): mixed
    {
        $body = json_decode((string) $this->send($this->request('GET', '/api'))->getBody(), true);

        return $body['data']['attributes']['sheafMaxQuotes'] ?? null;
    }

    #[Test]
    public function the_quote_limit_defaults_to_ten()
    {
        $this->assertSame(10, $this->maxQuotes());
    }

    #[Test]
    public function the_quote_limit_is_served_as_a_number()
    {
        $this->setting('ernestdefoe-sheaf.max_quotes', '25');

        $this->assertSame(25, $this->maxQuotes());
    }
}
